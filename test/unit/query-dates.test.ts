import assert from "node:assert/strict";
import test from "node:test";
import { matchesDateRange, resolveDateExpression, resolveQueryDateRanges } from "../../src/query/dates.js";

test("resolves aliases and signed offsets across month and year boundaries", () => {
  assert.equal(resolveDateExpression("today", "2026-01-01"), "2026-01-01");
  assert.equal(resolveDateExpression("yesterday", "2026-01-01"), "2025-12-31");
  assert.equal(resolveDateExpression("+31d", "2026-01-01"), "2026-02-01");
  assert.equal(resolveDateExpression("-1d", "2026-03-01"), "2026-02-28");
});

test("supports inclusive, exclusive and missing date semantics", () => {
  assert.equal(matchesDateRange("2026-10-06", { from: "today", to: "today" }, "2026-10-06"), true);
  assert.equal(matchesDateRange("2026-10-06", { from: "today", fromInclusive: false }, "2026-10-06"), false);
  assert.equal(matchesDateRange(null, { missing: true }, "2026-10-06"), true);
  assert.equal(matchesDateRange("2026-10-06", { missing: false }, "2026-10-06"), true);
  assert.equal(matchesDateRange(null, {}, "2026-10-06"), true);
});

test("rejects invalid expressions and contradictory ranges", () => {
  assert.throws(() => resolveDateExpression("next week", "2026-10-06"), /Invalid date expression/);
  assert.throws(() => matchesDateRange(null, { missing: true, from: "today" }, "2026-10-06"), /cannot contain bounds/);
  assert.throws(() => matchesDateRange("2026-10-06", { from: "+1d", to: "today" }, "2026-10-06"), /must not be after/);
  assert.throws(() => resolveDateExpression("+999999999999d", "2026-10-06"), /exceeds/);
});

test("resolves and validates all root and OR ranges before task evaluation", () => {
  const resolved = resolveQueryDateRanges({
    scheduled: { from: "today", to: "+7d" },
    anyOf: [{ due: { to: "tomorrow" } }, { created: { from: "-30d" } }],
  }, "2026-10-06");
  assert.equal(resolved.root.scheduled?.to, "2026-10-13");
  assert.equal(resolved.anyOf[0]?.due?.to, "2026-10-07");
  assert.equal(resolved.anyOf[1]?.created?.from, "2026-09-06");
  assert.throws(() => resolveQueryDateRanges({ scheduled: { from: "+1d", to: "today" } }, "2026-10-06"), /must not be after/);
});
