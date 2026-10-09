import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigValidationError, DEFAULT_TIMEZONE, loadConfig, parseConfig, resolveConfigPath } from "../../src/config/index.js";

test("parseConfig applies documented immutable defaults", () => {
  const config = parseConfig({ vaultRoot: "/srv/vault" });
  assert.equal(config.vaultRoot, "/srv/vault");
  assert.equal(config.timezone, DEFAULT_TIMEZONE);
  assert.deepEqual(config.scan.excludedDirectories, [".obsidian", ".trash"]);
  assert.equal(config.scan.maxFiles, 10_000);
  assert.equal(config.limits.maxReturnedTasks, 5_000);
  assert.equal(config.output.defaultFormat, "compact");
  assert.deepEqual(config.statuses.map(({ symbol, type }) => ({ symbol, type })), [
    { symbol: " ", type: "TODO" }, { symbol: "/", type: "IN_PROGRESS" },
    { symbol: "x", type: "DONE" }, { symbol: "-", type: "CANCELLED" },
  ]);
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.scan));
  assert.ok(Object.isFrozen(config.statuses));
});

test("parseConfig rejects unknown fields and invalid security-sensitive values", () => {
  assert.throws(() => parseConfig({ vaultRoot: "relative" }), ConfigValidationError);
  assert.throws(() => parseConfig({ vaultRoot: "/vault", typo: true }), /unknown field/);
  assert.throws(() => parseConfig({ vaultRoot: "/vault", timezone: "Mars\/Olympus" }), /IANA timezone/);
  assert.throws(() => parseConfig({ vaultRoot: "/vault", scan: { excludedDirectories: ["../private"] } }), /parent segments/);
  assert.throws(() => parseConfig({ vaultRoot: "/vault", scan: { maxFiles: 0 } }), /integer from 1/);
  assert.throws(() => parseConfig({ vaultRoot: "/vault", limits: { maxOutputBytes: 1 } }), /integer from 16384/);
});

test("parseConfig validates and preserves configurable status symbols", () => {
  const config = parseConfig({
    vaultRoot: "/vault",
    statuses: [{ symbol: "📌", name: "Pinned", type: "TODO" }],
  });
  assert.equal(config.statuses[0]?.symbol, "📌");
  assert.throws(() => parseConfig({
    vaultRoot: "/vault",
    statuses: [
      { symbol: "x", name: "Done", type: "DONE" },
      { symbol: "x", name: "Again", type: "TODO" },
    ],
  }), /must be unique/);
  assert.throws(() => parseConfig({ vaultRoot: "/vault", statuses: [{ symbol: "xx", name: "No", type: "TODO" }] }), /one Unicode character/);
});

test("archive configuration is opt-in and rejects overlapping roots", () => {
  const config = parseConfig({ vaultRoot: "/vault", archive: { archiveRoot: "Archive", sourceRoots: ["Income"], minAgeDays: 45 } });
  assert.deepEqual(config.archive, { archiveRoot: "Archive", sourceRoots: ["Income"], minAgeDays: 45, deleteEmptySourceNotes: true });
  assert.equal(parseConfig({ vaultRoot: "/vault", archive: { archiveRoot: "Archive", sourceRoots: ["Income"], deleteEmptySourceNotes: false } }).archive?.deleteEmptySourceNotes, false);
  assert.equal(parseConfig({ vaultRoot: "/vault" }).archive, undefined);
  assert.throws(() => parseConfig({ vaultRoot: "/vault", archive: { archiveRoot: "Income/Archive", sourceRoots: ["Income"] } }), /must not overlap/u);
  assert.throws(() => parseConfig({ vaultRoot: "/vault", archive: { archiveRoot: "Archive", sourceRoots: ["Income", "Income/Daily"] } }), /must not overlap/u);
  assert.deepEqual(parseConfig({ vaultRoot: "/vault", archive: { archiveRoot: "Archive", sourceRoots: ["."] } }).archive?.sourceRoots, ["."]);
  assert.throws(() => parseConfig({ vaultRoot: "/vault", archive: { archiveRoot: "Archive", sourceRoots: [".", "Income"] } }), /must not overlap/u);
});

test("loadConfig path precedence is explicit, environment, then default", () => {
  const directory = mkdtempSync(join(tmpdir(), "vault-tasks-config-"));
  const explicit = join(directory, "explicit.json");
  const environment = join(directory, "environment.json");
  writeFileSync(explicit, JSON.stringify({ vaultRoot: "/explicit" }));
  writeFileSync(environment, JSON.stringify({ vaultRoot: "/environment" }));
  assert.equal(loadConfig(explicit, { VAULT_TASKS_CONFIG: environment }).vaultRoot, "/explicit");
  assert.equal(loadConfig(undefined, { VAULT_TASKS_CONFIG: environment }).vaultRoot, "/environment");
  assert.equal(resolveConfigPath(undefined, {}), "/etc/vault-tasks/config.json");
});
