import assert from "node:assert/strict";
import test from "node:test";

import { CliArgumentError, parseArguments } from "../../src/cli/arguments.js";

test("parses query, explain, schema, and help without accepting a vault root", () => {
  assert.deepEqual(parseArguments(["query", "--json", "{}"]), { name: "query", json: "{}" });
  assert.deepEqual(parseArguments(["query", "--format", "detailed", "--as-of", "2026-10-06", "--json", "{}"]), {
    name: "query", json: "{}", format: "detailed", asOf: "2026-10-06",
  });
  assert.deepEqual(parseArguments(["explain", "--json", "{}"]), { name: "explain", json: "{}" });
  assert.deepEqual(parseArguments(["schema"]), { name: "schema" });
  assert.deepEqual(parseArguments(["archive-done", "--apply", "--as-of", "2026-10-06"]), { name: "archive-done", apply: true, asOf: "2026-10-06" });
  assert.deepEqual(parseArguments([]), { name: "help" });
  assert.throws(() => parseArguments(["query", "--json", "{}", "--vault-root", "/tmp"]), CliArgumentError);
  assert.throws(() => parseArguments(["archive-done", "--json", "{}"]), CliArgumentError);
});

test("rejects malformed, duplicate, and unsupported arguments", () => {
  assert.throws(() => parseArguments(["query"]), /requires --json/u);
  assert.throws(() => parseArguments(["query", "--json", "{}", "--json", "{}"]), /only once/u);
  assert.throws(() => parseArguments(["explain", "--json", "{}", "--format", "compact"]), /only by query/u);
  assert.throws(() => parseArguments(["query", "--json", "{}", "--as-of", "2026-02-30"]), /valid calendar date/u);
});
