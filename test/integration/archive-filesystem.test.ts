import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { archiveDone } from "../../src/archive/service.js";

const base = {
  archive: { archiveRoot: "Archive", sourceRoots: ["Income"], minAgeDays: 30, deleteEmptySourceNotes: false },
  statuses: [{ symbol: "x", name: "Done", type: "DONE" as const }], asOf: "2026-10-06", apply: true,
};
async function fixture(): Promise<string> { return mkdtemp(path.join(tmpdir(), "vault-tasks-archive-")); }

test("concrete store creates a missing archive root before editing its source", async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, "Income"));
    await writeFile(path.join(root, "Income", "day.md"), "# Day\n- [x] old ✅ 2026-01-01\n- [x] open ✅ 2026-10-01\n");
    const result = await archiveDone({ ...base, vaultRoot: root });
    assert.equal(result.partial, false);
    assert.match(await readFile(path.join(root, "Archive", "Income", "day.md"), "utf8"), /old/u);
    assert.doesNotMatch(await readFile(path.join(root, "Income", "day.md"), "utf8"), /old/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concrete store refuses an archive-root symlink and leaves source intact", async (context) => {
  if (process.platform === "win32") context.skip("symlink creation is not generally available");
  const root = await fixture(); const outside = await fixture();
  try {
    await mkdir(path.join(root, "Income"));
    const source = path.join(root, "Income", "day.md");
    await writeFile(source, "- [x] old ✅ 2026-01-01\n");
    await symlink(outside, path.join(root, "Archive"));
    const result = await archiveDone({ ...base, vaultRoot: root });
    assert.equal(result.partial, true);
    assert.match(await readFile(source, "utf8"), /old/u);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test("removes empty source subdirectories after deleting a task-free note", async () => {
  const root = await fixture();
  try {
    const month = path.join(root, "Income", "2026", "04");
    await mkdir(month, { recursive: true });
    await writeFile(path.join(month, "day.md"), "# Empty day\n");
    const result = await archiveDone({ ...base, vaultRoot: root, archive: { ...base.archive, deleteEmptySourceNotes: true } });
    assert.equal(result.deletedSourceNotes, 1);
    assert.equal(await readFile(path.join(root, "Archive", "Income", "2026", "04", "day.md"), "utf8"), "# Empty day\n");
    await assert.rejects(lstat(month));
    await assert.rejects(lstat(path.join(root, "Income", "2026")));
    assert.equal((await lstat(path.join(root, "Income"))).isDirectory(), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
