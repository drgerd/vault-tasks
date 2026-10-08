import assert from "node:assert/strict";
import test from "node:test";
import { projectResult } from "../../src/output/project-result.js";
import { resolveDependencies } from "../../src/query/dependencies.js";
import type { ParsedTask } from "../../src/query/types.js";

function tasks(count: number): ParsedTask[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `Folder/Task ${index}.md`, line: index + 1, markdown: `- [ ] task ${index}`, description: `task ${index}`,
    status: { symbol: " ", name: "Todo", type: "TODO" as const },
    dates: { scheduled: null, due: null, created: null, start: null, done: null, cancelled: null },
    priority: "none" as const, tags: [], heading: { nearest: null, hierarchy: [] }, recurrence: { isRecurring: false, rule: null },
    taskId: index === 0 ? "one" : null, dependsOn: [],
  }));
}

test("compact preserves exact markdown and encodes optional Obsidian URI", () => {
  const enriched = resolveDependencies(tasks(1)).tasks;
  const result = projectResult(enriched, {
    format: "compact", asOf: "2026-10-06", timezone: "Europe/Warsaw", filesScanned: 1, tasksScanned: 1,
    maxReturnedTasks: 5, maxOutputBytes: 10_000, vaultName: "My Vault",
  });
  assert.deepEqual(result.tasks[0], {
    path: "Folder/Task 0.md", line: 1, markdown: "- [ ] task 0", taskId: "one",
    obsidianUri: "obsidian://open?vault=My%20Vault&file=Folder%2FTask%200.md",
  });
});

test("count limit keeps totalMatches and adds one truncation warning", () => {
  const enriched = resolveDependencies(tasks(3)).tasks;
  const result = projectResult(enriched, {
    format: "compact", asOf: "2026-10-06", timezone: "Europe/Warsaw", filesScanned: 3, tasksScanned: 3,
    maxReturnedTasks: 1, maxOutputBytes: 10_000,
  });
  assert.deepEqual(result.stats, { filesScanned: 3, tasksScanned: 3, totalMatches: 3, returned: 1, truncated: true });
  assert.equal(result.warnings[0]?.code, "OUTPUT_TRUNCATED");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)));
});

test("byte limit produces a valid bounded envelope", () => {
  const enriched = resolveDependencies(tasks(20)).tasks;
  const baseline = projectResult([], {
    format: "compact", asOf: "2026-10-06", timezone: "Europe/Warsaw", filesScanned: 20, tasksScanned: 20,
    maxReturnedTasks: 20, maxOutputBytes: 100_000,
  });
  const minimum = Buffer.byteLength(JSON.stringify(baseline), "utf8") + 450;
  const result = projectResult(enriched, {
    format: "compact", asOf: "2026-10-06", timezone: "Europe/Warsaw", filesScanned: 20, tasksScanned: 20,
    maxReturnedTasks: 20, maxOutputBytes: minimum,
  });
  assert.equal(result.stats.truncated, true);
  assert.ok(result.stats.returned < 20);
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= minimum);
});

test("oversized warning lists are summarized without invalidating the envelope", () => {
  const enriched = resolveDependencies(tasks(1)).tasks;
  const maxOutputBytes = 1_000;
  const result = projectResult(enriched, {
    format: "compact", asOf: "2026-10-06", timezone: "Europe/Warsaw", filesScanned: 1, tasksScanned: 1,
    maxReturnedTasks: 20, maxOutputBytes,
    warnings: Array.from({ length: 5 }, (_, index) => ({ code: "FILE_SKIPPED" as const, message: `${index}:${"x".repeat(5_000)}` })),
  });
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= maxOutputBytes);
  assert.equal(result.stats.truncated, true);
  const summary = result.warnings.at(-1);
  assert.equal(summary?.code, "OUTPUT_TRUNCATED");
  assert.equal(summary?.details?.omittedWarnings, 5);
});
