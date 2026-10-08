import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMarkdownTasks } from "../../src/vault/parse-task.js";

const statuses = [
  { symbol: " ", name: "Todo", type: "TODO" as const },
  { symbol: "/", name: "In Progress", type: "IN_PROGRESS" as const },
  { symbol: "x", name: "Done", type: "DONE" as const },
  { symbol: "-", name: "Cancelled", type: "CANCELLED" as const },
];

test("parses exact task source and all supported metadata", () => {
  const raw = "  - [/] Write parser #work/sub #next ⏳ 2026-10-07 📅 2026-10-08 ➕ 2026-10-01 🛫 2026-10-03 ✅ 2026-10-09 ❌ 2026-10-10 🔺 🔁 every week 🆔 task-a ⛔ dep-1, dep-2";
  const tasks = parseMarkdownTasks(`# Project\n## Daily work\n${raw}`, {
    path: "Folder/Note.md",
    statuses,
  });

  assert.equal(tasks.length, 1);
  const task = tasks[0];
  assert.ok(task);
  assert.equal(task.markdown, raw);
  assert.equal(task.path, "Folder/Note.md");
  assert.equal(task.line, 3);
  assert.deepEqual(task.status, { symbol: "/", name: "In Progress", type: "IN_PROGRESS" });
  assert.deepEqual(task.heading, { nearest: "Daily work", hierarchy: ["Project", "Daily work"] });
  assert.deepEqual(task.tags, ["#work/sub", "#next"]);
  assert.deepEqual(task.dates, {
    scheduled: "2026-10-07",
    due: "2026-10-08",
    created: "2026-10-01",
    start: "2026-10-03",
    done: "2026-10-09",
    cancelled: "2026-10-10",
  });
  assert.equal(task.priority, "highest");
  assert.deepEqual(task.recurrence, { isRecurring: true, rule: "every week" });
  assert.equal(task.taskId, "task-a");
  assert.deepEqual(task.dependsOn, ["dep-1", "dep-2"]);
  assert.equal(task.description, "Write parser #work/sub #next");
});

test("tracks heading hierarchy, preserves unknown status, and ignores fenced examples", () => {
  const markdown = [
    "# Home",
    "- [ ] top level",
    "### Later",
    "\t* [?] indented unknown 🔽",
    "```tasks",
    "- [ ] example only 📅 2026-10-06",
    "```",
    "## Personal:",
    "1. [x] completed",
  ].join("\n");
  const tasks = parseMarkdownTasks(markdown, { path: "Daily.md", statuses });

  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks[1]?.heading, { nearest: "Later", hierarchy: ["Home", "Later"] });
  assert.deepEqual(tasks[1]?.status, { symbol: "?", name: "Unknown", type: "UNKNOWN" });
  assert.equal(tasks[1]?.priority, "low");
  assert.equal(tasks[2]?.heading.nearest, "Personal:");
  assert.equal(tasks[2]?.line, 9);
});

test("keeps scheduled, due, and created independent", () => {
  const [task] = parseMarkdownTasks("- [ ] Plan ⏳ 2026-10-11 📅 2026-10-12 ➕ 2026-10-06", {
    path: "Plan.md",
    statuses,
  });
  assert.ok(task);
  assert.equal(task.dates.scheduled, "2026-10-11");
  assert.equal(task.dates.due, "2026-10-12");
  assert.equal(task.dates.created, "2026-10-06");
  assert.match(task.markdown, /⏳ 2026-10-11.*📅 2026-10-12.*➕ 2026-10-06/u);
});
