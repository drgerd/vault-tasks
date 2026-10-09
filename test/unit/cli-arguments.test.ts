import assert from "node:assert/strict";
import test from "node:test";

import { CliArgumentError, parseArguments } from "../../src/cli/arguments.js";

test("parses query, explain, schema, help, and direct archive options", () => {
  assert.deepEqual(parseArguments(["query", "--json", "{}"]), { name: "query", json: "{}" });
  assert.deepEqual(parseArguments(["query", "--format", "detailed", "--as-of", "2026-10-06", "--json", "{}"]), {
    name: "query", json: "{}", format: "detailed", asOf: "2026-10-06",
  });
  assert.deepEqual(parseArguments(["explain", "--json", "{}"]), { name: "explain", json: "{}" });
  assert.deepEqual(parseArguments(["schema"]), { name: "schema" });
  assert.deepEqual(parseArguments(["archive-done", "--as-of", "2026-10-06"]), { name: "archive-done", dryRun: false, sourceRoots: [], asOf: "2026-10-06" });
  assert.deepEqual(parseArguments(["archive-done", "--dry-run"]), { name: "archive-done", dryRun: true, sourceRoots: [] });
  assert.deepEqual(parseArguments([
    "archive-done", "--vault-root", "/vault", "--archive-root", "Done", "--source-root", "Income", "--source-root", "Work",
    "--min-age-days", "14", "--timezone", "Europe/Warsaw", "--keep-source-notes",
  ]), {
    name: "archive-done", dryRun: false, vaultRoot: "/vault", archiveRoot: "Done", sourceRoots: ["Income", "Work"],
    minAgeDays: 14, timezone: "Europe/Warsaw", deleteEmptySourceNotes: false,
  });
  assert.deepEqual(parseArguments([]), { name: "help" });
  assert.throws(() => parseArguments(["query", "--json", "{}", "--vault-root", "/tmp"]), CliArgumentError);
  assert.throws(() => parseArguments(["archive-done", "--json", "{}"]), CliArgumentError);
  assert.throws(() => parseArguments(["archive-done", "--apply"]), CliArgumentError);
  assert.throws(() => parseArguments(["archive-done", "--dry-run", "--dry-run"]), /only once/u);
  assert.throws(() => parseArguments(["archive-done", "--archive-root", "Archive"]), /require --vault-root/u);
  assert.throws(() => parseArguments(["archive-done", "--vault-root", "/vault", "--min-age-days", "-1"]), /non-negative integer/u);
});

test("rejects malformed, duplicate, and unsupported arguments", () => {
  assert.throws(() => parseArguments(["query"]), /requires --json/u);
  assert.throws(() => parseArguments(["query", "--json", "{}", "--json", "{}"]), /only once/u);
  assert.throws(() => parseArguments(["explain", "--json", "{}", "--format", "compact"]), /only by query/u);
  assert.throws(() => parseArguments(["query", "--json", "{}", "--as-of", "2026-02-30"]), /valid calendar date/u);
});
