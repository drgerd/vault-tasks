import assert from "node:assert/strict";
import test from "node:test";
import { TASK_DATE_FIELDS, type TaskDateField } from "../../src/model/index.js";
import { executeQuery } from "../../src/query/query-service.js";
import type { ParsedTask } from "../../src/query/types.js";

function task(overrides: Partial<ParsedTask> = {}): ParsedTask {
  return {
    path: "Daily/2026-10-06.md", line: 1, markdown: "- [ ] task", description: "task",
    status: { symbol: " ", name: "Todo", type: "TODO" },
    dates: { scheduled: null, due: null, created: null, start: null, done: null, cancelled: null },
    priority: "none", tags: [], heading: { nearest: null, hierarchy: [] },
    recurrence: { isRecurring: false, rule: null }, taskId: null, dependsOn: [], ...overrides,
  };
}

const options = {
  format: "detailed" as const, asOf: "2026-10-06", timezone: "Europe/Warsaw",
  maxReturnedTasks: 100, maxOutputBytes: 100_000,
};

function datesFor(field: TaskDateField, value: string): ParsedTask["dates"] {
  return { scheduled: null, due: null, created: null, start: null, done: null, cancelled: null, [field]: value };
}

test("combines root filters with bounded root OR and keeps dates distinct", () => {
  const tasks = [
    task({ line: 1, dates: { scheduled: "2026-10-05", due: null, created: "2026-10-01", start: null, done: null, cancelled: null } }),
    task({ line: 2, dates: { scheduled: null, due: "2026-10-06", created: "2026-09-01", start: null, done: null, cancelled: null } }),
    task({ line: 3, status: { symbol: "x", name: "Done", type: "DONE" }, dates: { scheduled: "2026-10-05", due: null, created: null, start: null, done: "2026-10-06", cancelled: null } }),
  ];
  const result = executeQuery({ tasks, filesScanned: 1 }, { ...options, query: {
    status: { anyOf: ["TODO", "IN_PROGRESS"] },
    anyOf: [{ scheduled: { to: "today" } }, { due: { to: "today" } }],
  } });
  assert.deepEqual(result.tasks.map(({ line }) => line), [1, 2]);
  assert.equal(result.stats.totalMatches, 2);
  assert.deepEqual((result.tasks[0] as { dates: unknown }).dates, tasks[0]!.dates);
});

test("supports headings, tags, relative created ranges, priority and recurrence", () => {
  const matching = task({
    heading: { nearest: " Personal: ", hierarchy: ["2026", " Personal: "] }, tags: ["#ask", "#agent"],
    dates: { scheduled: null, due: null, created: "2026-09-20", start: null, done: null, cancelled: null },
    priority: "high", recurrence: { isRecurring: true, rule: "every week" }, taskId: "a",
  });
  const result = executeQuery({ tasks: [matching, task({ line: 2 })], filesScanned: 1 }, { ...options, query: {
    heading: { anyOf: ["personal"] }, tags: { allOf: ["#ask", "#agent"], noneOf: ["#archive"] },
    created: { from: "-30d", to: "today" }, scheduled: { missing: true },
    priority: { atLeast: "high" }, recurrence: { state: "only", contains: "WEEK" }, id: { present: true },
  } });
  assert.equal(result.stats.totalMatches, 1);
  assert.equal(result.tasks[0]?.taskId, "a");
});

test("applies deterministic multi-key sorting and implicit path/line tie-break", () => {
  const tasks = [
    task({ path: "b.md", line: 2, priority: "low" }), task({ path: "a.md", line: 3, priority: "high" }),
    task({ path: "a.md", line: 1, priority: "high" }), task({ path: "c.md", line: 1, priority: "none" }),
  ];
  const result = executeQuery({ tasks, filesScanned: 3 }, { ...options, format: "compact", query: { sort: [{ field: "priority", direction: "desc" }] } });
  assert.deepEqual(result.tasks.map(({ path, line }) => `${path}:${line}`), ["a.md:1", "a.md:3", "c.md:1", "b.md:2"]);
});

test("filters and sorts every canonical task-date field", () => {
  for (const field of TASK_DATE_FIELDS) {
    const tasks = [
      task({ line: 1, dates: datesFor(field, "2026-10-06") }),
      task({ line: 2, dates: datesFor(field, "2026-10-07") }),
    ];
    const filtered = executeQuery({ tasks, filesScanned: 1 }, {
      ...options, query: { [field]: { to: "today" } },
    });
    assert.deepEqual(filtered.tasks.map(({ line }) => line), [1], `${field} filter`);

    const sorted = executeQuery({ tasks, filesScanned: 1 }, {
      ...options, format: "compact", query: { sort: [{ field, direction: "desc" }] },
    });
    assert.deepEqual(sorted.tasks.map(({ line }) => line), [2, 1], `${field} sort`);
  }
});

test("resolves only unique active direct dependencies and emits warnings", () => {
  const predecessor = task({ line: 1, taskId: "first" });
  const dependent = task({ line: 2, taskId: "second", dependsOn: ["first", "missing"] });
  const duplicate1 = task({ line: 3, taskId: "dup" });
  const duplicate2 = task({ line: 4, taskId: "dup" });
  const result = executeQuery({ tasks: [predecessor, dependent, duplicate1, duplicate2], filesScanned: 1 }, { ...options, query: { dependencies: { blocked: true } } });
  assert.deepEqual(result.tasks.map(({ line }) => line), [2]);
  assert.deepEqual(result.warnings.map(({ code }) => code).sort(), ["DUPLICATE_TASK_ID", "UNRESOLVED_DEPENDENCY"]);
  const detailed = result.tasks[0] as { blockedBy: Array<{ id: string }>; isBlocked: boolean };
  assert.equal(detailed.isBlocked, true);
  assert.deepEqual(detailed.blockedBy.map(({ id }) => id), ["first"]);
});

test("done and cancelled predecessors do not actively block", () => {
  const done = task({ line: 1, taskId: "done", status: { symbol: "x", name: "Done", type: "DONE" } });
  const cancelled = task({ line: 2, taskId: "cancelled", status: { symbol: "-", name: "Cancelled", type: "CANCELLED" } });
  const dependent = task({ line: 3, dependsOn: ["done", "cancelled"] });
  const result = executeQuery({ tasks: [done, cancelled, dependent], filesScanned: 1 }, { ...options, query: { dependencies: { blocked: false, hasDependencies: true } } });
  assert.deepEqual(result.tasks.map(({ line }) => line), [3]);
});

test("validates date ranges even when the scan contains no tasks", () => {
  assert.throws(() => executeQuery({ tasks: [], filesScanned: 0 }, {
    ...options, query: { scheduled: { from: "+1d", to: "today" } },
  }), /must not be after/);
});

test("source prefixes match whole path segments", () => {
  const result = executeQuery({ tasks: [
    task({ path: "Agent/Task.md", line: 1 }),
    task({ path: "Agent.md", line: 2 }),
    task({ path: "Agents/Task.md", line: 3 }),
  ], filesScanned: 3 }, { ...options, query: { source: { pathPrefixesAny: ["Agent"] } } });
  assert.deepEqual(result.tasks.map(({ line }) => line), [1]);
});

test("self-dependencies warn and do not create active graph edges", () => {
  const self = task({ taskId: "self", dependsOn: ["self"] });
  const result = executeQuery({ tasks: [self], filesScanned: 1 }, { ...options, query: {} });
  assert.equal(result.warnings[0]?.code, "SELF_DEPENDENCY");
  const detailed = result.tasks[0] as { isBlocked: boolean; isBlocking: boolean; blockedBy: unknown[]; blocks: unknown[] };
  assert.equal(detailed.isBlocked, false);
  assert.equal(detailed.isBlocking, false);
  assert.deepEqual(detailed.blockedBy, []);
  assert.deepEqual(detailed.blocks, []);
});
