import assert from "node:assert/strict";
import test from "node:test";

import { parseConfig } from "../../src/config/index.js";
import { runCli, type CliIo } from "../../src/cli/main.js";
import type { CliDependencies } from "../../src/cli/main.js";

const config = parseConfig({ vaultRoot: "/fixture", vaultName: "fixture" });

function harness(scan: CliDependencies["scan"]): { io: CliIo; stdout: string[]; stderr: string[]; dependencies: CliDependencies } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
    dependencies: { loadConfig: () => config, clock: { now: () => new Date("2026-10-06T22:30:00Z") }, scan },
  };
}

test("query composes config, scan, dependency resolution, and compact output", async () => {
  let scanCalls = 0;
  const h = harness(async () => {
    scanCalls += 1;
    return {
      filesScanned: 1,
      bytesRead: 50,
      warnings: [],
      tasks: [{
        path: "Tasks.md", line: 2, markdown: "- [ ] plan ⏳ 2026-10-07 📅 2026-10-09", description: "plan",
        status: { symbol: " ", name: "Todo", type: "TODO" },
        dates: { scheduled: "2026-10-07", due: "2026-10-09", created: null, start: null, done: null, cancelled: null },
        priority: "none", tags: [], heading: { nearest: null, hierarchy: [] },
        recurrence: { isRecurring: false, rule: null }, taskId: null, dependsOn: [],
        blockedBy: [], blocks: [], isBlocked: false, isBlocking: false,
      }],
    };
  });
  const exit = await runCli(["query", "--json", "{\"scheduled\":{\"from\":\"today\",\"to\":\"+7d\"}}"], h.io, h.dependencies);
  assert.equal(exit, 0);
  assert.equal(scanCalls, 1);
  assert.equal(h.stderr.length, 0);
  const result = JSON.parse(h.stdout.join("")) as { tasks: Array<{ markdown: string; obsidianUri: string }>; asOf: string };
  assert.equal(result.asOf, "2026-10-07");
  assert.equal(result.tasks[0]?.markdown, "- [ ] plan ⏳ 2026-10-07 📅 2026-10-09");
  assert.match(result.tasks[0]?.obsidianUri ?? "", /^obsidian:\/\/open/u);
});

test("explain validates without scanning and errors stay on stderr", async () => {
  let scanCalls = 0;
  const h = harness(async () => { scanCalls += 1; throw new Error("must not scan"); });
  assert.equal(await runCli(["explain", "--json", "{\"created\":{\"from\":\"-30d\"}}", "--as-of", "2026-10-06"], h.io, h.dependencies), 0);
  assert.equal(scanCalls, 0);
  const explanation = JSON.parse(h.stdout.join("")) as { asOf: string; query: { created: { from: string } } };
  assert.equal(explanation.asOf, "2026-10-06");
  assert.equal(explanation.query.created.from, "2026-09-06");

  h.stdout.length = 0;
  assert.equal(await runCli(["query", "--json", "{broken"], h.io, h.dependencies), 2);
  assert.equal(h.stdout.length, 0);
  assert.equal(JSON.parse(h.stderr.at(-1) ?? "{}").error.code, "CLI_ARGUMENT_ERROR");
});

test("invalid resolved ranges fail before an empty vault scan", async () => {
  let scanCalls = 0;
  const h = harness(async () => {
    scanCalls += 1;
    return { tasks: [], filesScanned: 0, bytesRead: 0, warnings: [] };
  });
  const exit = await runCli([
    "query", "--json", "{\"scheduled\":{\"from\":\"+7d\",\"to\":\"today\"}}", "--as-of", "2026-10-06",
  ], h.io, h.dependencies);
  assert.equal(exit, 2);
  assert.equal(scanCalls, 0);
  assert.equal(JSON.parse(h.stderr.at(-1) ?? "{}").error.code, "QUERY_VALIDATION_ERROR");
});

test("schema is path-free and does not load configuration", async () => {
  const stdout: string[] = [];
  let loaded = false;
  const exit = await runCli(["schema"], { stdout: (v) => stdout.push(v), stderr: () => undefined }, {
    loadConfig: () => { loaded = true; throw new Error("not expected"); },
    clock: { now: () => new Date() },
    scan: async () => { throw new Error("not expected"); },
  });
  assert.equal(exit, 0);
  assert.equal(loaded, false);
  const schemaText = stdout.join("");
  assert.doesNotMatch(schemaText, /\/fixture|vaultRoot.*string/u);
  const schema = JSON.parse(schemaText) as { limits: { maxOutputBytes: { default: number } } };
  assert.equal(schema.limits.maxOutputBytes.default, 2_097_152);
});

test("archive command is gated by config and query excludes configured archive root", async () => {
  const missing = harness(async () => ({ tasks: [], filesScanned: 0, bytesRead: 0, warnings: [] }));
  assert.equal(await runCli(["archive-done"], missing.io, missing.dependencies), 2);
  assert.match(missing.stderr.join(""), /ARCHIVE_NOT_CONFIGURED/u);

  let excluded: readonly string[] = [];
  const archiveConfig = parseConfig({ vaultRoot: "/fixture", archive: { archiveRoot: "Archive", sourceRoots: ["Income"] } });
  const io = { stdout: () => undefined, stderr: () => undefined };
  await runCli(["query", "--json", "{}"], io, {
    loadConfig: () => archiveConfig,
    clock: { now: () => new Date("2026-10-06T22:30:00Z") },
    scan: async (options) => { excluded = options.scan.excludedDirectories; return { tasks: [], filesScanned: 0, bytesRead: 0, warnings: [] }; },
  });
  assert.ok(excluded.includes("Archive"));
});
