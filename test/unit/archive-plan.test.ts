import assert from "node:assert/strict";
import test from "node:test";

import { planDocument } from "../../src/archive/plan.js";

const statuses = [
  { symbol: " ", name: "Todo", type: "TODO" as const },
  { symbol: "x", name: "Done", type: "DONE" as const },
  { symbol: "-", name: "Cancelled", type: "CANCELLED" as const },
];

test("plans only terminal-status tasks old enough by their matching terminal date", () => {
  const plan = planDocument("Income/day.md", [
    "# Day\n", "- [x] old ✅ 2026-09-06 📅 2030-01-01\n", "- [-] cancelled ❌ 2026-09-06\n",
    "- [x] recent ✅ 2026-09-08\n", "- [x] missing 📅 2020-01-01\n", "- [ ] open ✅ 2020-01-01\n",
  ].join(""), statuses, "2026-10-06", 30, false);
  assert.equal(plan.considered, 5);
  assert.equal(plan.eligible, 2);
  assert.equal(plan.skipped, 3);
  assert.deepEqual(plan.warnings, [{ code: "MISSING_TERMINAL_DATE", path: "Income/day.md", line: 5, markdown: "- [x] missing 📅 2020-01-01" }]);
  assert.match(plan.sourceEdits[0]?.blocks[0]?.text ?? "", /old ✅ 2026-09-06/u);
  assert.match(plan.sourceEdits[0]?.blocks[1]?.text ?? "", /cancelled/u);
});

test("preserves CRLF raw blocks and archives a fully finalized nested subtree", () => {
  const plan = planDocument("Income/day.md", "# H\r\n- [x] keep raw ✅ 2026-01-01\r\n  detail\r\n- [x] parent ✅ 2026-01-01\r\n  - [x] child ✅ 2026-01-01\r\n", statuses, "2026-10-06", 30, false);
  assert.equal(plan.eligible, 2);
  assert.equal(plan.warnings.length, 0);
  assert.equal(plan.sourceEdits[0]?.blocks[0]?.text, "- [x] keep raw ✅ 2026-01-01\r\n  detail\r\n");
  assert.equal(plan.sourceEdits[0]?.blocks[1]?.text, "- [x] parent ✅ 2026-01-01\r\n  - [x] child ✅ 2026-01-01\r\n");
});

test("archives an eligible root together with its open child without warning", () => {
  const plan = planDocument("Income/day.md", "- [x] root ✅ 2026-01-01\n  - [ ] child\n", statuses, "2026-10-06", 30, false);
  assert.equal(plan.eligible, 1);
  assert.equal(plan.warnings.length, 0);
  assert.equal(plan.sourceEdits[0]?.blocks[0]?.text, "- [x] root ✅ 2026-01-01\n  - [ ] child\n");
});

test("archives child content regardless of status, date, or checklist details", () => {
  const completed = planDocument("Income/day.md", "- [x] root ✅ 2026-01-01\n  - [-] child ❌ 2026-01-02\n", statuses, "2026-10-06", 30, false);
  assert.equal(completed.eligible, 1);
  const recent = planDocument("Income/day.md", "- [x] root ✅ 2026-01-01\n  - [x] child ✅ 2026-10-01\n", statuses, "2026-10-06", 30, false);
  assert.equal(recent.eligible, 1);
  const content = planDocument("Income/day.md", "- [x] root ✅ 2026-01-01\n  details\n  - [ ] child without terminal date\n", statuses, "2026-10-06", 30, false);
  assert.equal(content.eligible, 1);
  assert.equal(content.warnings.length, 0);
});

test("allows consistently indented top-level task lists", () => {
  const plan = planDocument("Income/day.md", "###### Daily\n - [x] first ✅ 2026-01-01\n - [x] second ✅ 2026-01-01\n", statuses, "2026-10-06", 30, false);
  assert.equal(plan.eligible, 2);
  assert.equal(plan.warnings.length, 0);
});

test("does not parse fenced examples and deletes a task-free source note with prose", () => {
  const plan = planDocument("Income/day.md", "# Keep\n```md\n- [x] example ✅ 2020-01-01\n```\n# Move\n- [x] real ✅ 2020-01-01\n", statuses, "2026-10-06", 30, true);
  assert.equal(plan.considered, 1);
  assert.equal(plan.sourceEdits[0]?.deleteNote, true);
  assert.equal(plan.sourceEdits[0]?.archiveWholeNote, true);
  const deletable = planDocument("Income/only.md", "An observation\n# Move\n- [x] real ✅ 2020-01-01\n", statuses, "2026-10-06", 30, true);
  assert.equal(deletable.sourceEdits[0]?.deleteNote, true);
  const retained = planDocument("Income/open.md", "Prose\n- [x] real ✅ 2020-01-01\n- [ ] open\n", statuses, "2026-10-06", 30, true);
  assert.equal(retained.sourceEdits[0]?.deleteNote, false);
});

test("archives and removes a source note that already has no checklist tasks", () => {
  const markdown = "---\ntemplate: daily\n---\n# A day with no tasks\n";
  const deleted = planDocument("Income/empty.md", markdown, statuses, "2026-10-06", 30, true);
  assert.equal(deleted.considered, 0);
  assert.equal(deleted.eligible, 0);
  assert.equal(deleted.sourceEdits[0]?.deleteNote, true);
  assert.equal(deleted.sourceEdits[0]?.archiveWholeNote, true);
  assert.deepEqual(deleted.sourceEdits[0]?.blocks, []);
  const retained = planDocument("Income/empty.md", markdown, statuses, "2026-10-06", 30, false);
  assert.deepEqual(retained.sourceEdits, []);
});

test("invalid terminal calendar dates are safely skipped", () => {
  const plan = planDocument("Income/day.md", "- [x] impossible ✅ 2026-99-99\n", statuses, "2026-10-06", 30, false);
  assert.equal(plan.eligible, 0);
  assert.deepEqual(plan.warnings, [{ code: "MISSING_TERMINAL_DATE", path: "Income/day.md", line: 1, markdown: "- [x] impossible ✅ 2026-99-99" }]);
});
