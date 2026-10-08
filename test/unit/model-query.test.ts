import assert from "node:assert/strict";
import test from "node:test";
import { PRIORITY_RANK, QUERY_SCHEMA, QueryValidationError, TASK_DATE_FIELDS, validateAndNormalizeQuery } from "../../src/model/index.js";

const limits = { maxAnyOfClauses: 2, maxSortFields: 2 };

test("empty query is valid and scheduled/due remain independent", () => {
  assert.deepEqual(validateAndNormalizeQuery({}, limits), {});
  assert.deepEqual(validateAndNormalizeQuery({
    scheduled: { from: "today", to: "+7d" },
    due: { missing: true },
    created: { from: "-30d", to: "yesterday", fromInclusive: false },
  }, limits), {
    scheduled: { from: "today", to: "+7d", fromInclusive: true, toInclusive: true },
    due: { missing: true },
    created: { from: "-30d", to: "yesterday", fromInclusive: false, toInclusive: true },
  });
});

test("uses one canonical task-date vocabulary and priority order", () => {
  assert.deepEqual(TASK_DATE_FIELDS, ["scheduled", "due", "created", "start", "done", "cancelled"]);
  assert.equal(PRIORITY_RANK.lowest < PRIORITY_RANK.none, true);
  assert.equal(PRIORITY_RANK.none < PRIORITY_RANK.highest, true);
  assert.deepEqual(
    TASK_DATE_FIELDS.filter((field) => field in QUERY_SCHEMA.properties),
    TASK_DATE_FIELDS,
  );
});

test("normalizes headings, tags, status space symbol, and source separators", () => {
  const query = validateAndNormalizeQuery({
    heading: { anyOf: [" Home ToDo: "] },
    tags: { allOf: ["agent", "#ask"] },
    status: { anyOf: ["TODO", "IN_PROGRESS"], symbols: [" ", "/"] },
    source: { pathsAny: ["Agent\\Assistant\\Test.md"], pathPrefixesAny: ["Agent/"], fileNamesAny: ["Test.md"] },
  }, limits);
  assert.deepEqual(query.heading?.anyOf, ["Home ToDo"]);
  assert.deepEqual(query.tags?.allOf, ["#agent", "#ask"]);
  assert.deepEqual(query.status?.symbols, [" ", "/"]);
  assert.deepEqual(query.source?.pathsAny, ["Agent/Assistant/Test.md"]);
  assert.deepEqual(query.source?.pathPrefixesAny, ["Agent"]);
});

test("allows one bounded non-recursive OR and bounded sorting", () => {
  const query = validateAndNormalizeQuery({
    status: { anyOf: ["TODO"] },
    anyOf: [{ scheduled: { to: "today" } }, { due: { to: "today" } }],
    sort: [{ field: "scheduled", direction: "asc", missing: "last" }],
  }, limits);
  assert.equal(query.anyOf?.length, 2);
  assert.throws(() => validateAndNormalizeQuery({ anyOf: [{ anyOf: [] }] }, limits), /unknown field/);
  assert.throws(() => validateAndNormalizeQuery({ anyOf: [{}, {}, {}] }, limits), /at most 2/);
  assert.throws(() => validateAndNormalizeQuery({ sort: [
    { field: "path", direction: "asc" }, { field: "line", direction: "asc" }, { field: "due", direction: "asc" },
  ] }, limits), /at most 2/);
});

test("rejects malformed dates, contradictions, traversal, and unknown fields", () => {
  assert.throws(() => validateAndNormalizeQuery({ scheduled: { from: "2026-02-30" } }, limits), QueryValidationError);
  assert.throws(() => validateAndNormalizeQuery({ due: { missing: true, to: "today" } }, limits), /cannot be combined/);
  assert.throws(() => validateAndNormalizeQuery({ created: { fromInclusive: false } }, limits), /requires from/);
  assert.throws(() => validateAndNormalizeQuery({ source: { pathsAny: ["../secret.md"] } }, limits), /parent segments/);
  assert.throws(() => validateAndNormalizeQuery({ source: { pathPrefixesAny: ["../private/"] } }, limits), /parent segments/);
  assert.throws(() => validateAndNormalizeQuery({ recurrence: { state: "exclude", contains: "week" } }, limits), /cannot be combined/);
  assert.throws(() => validateAndNormalizeQuery({ preset: "home" }, limits), /unknown field/);
});

test("schema metadata is public and contains no deployment paths", () => {
  assert.equal(QUERY_SCHEMA.title, "vault-tasks query");
  assert.ok("scheduled" in QUERY_SCHEMA.properties);
  assert.doesNotMatch(JSON.stringify(QUERY_SCHEMA), /vaultRoot|\/Users\//);
});
