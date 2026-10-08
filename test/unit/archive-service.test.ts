import assert from "node:assert/strict";
import test from "node:test";

import { archiveDone, type ArchiveStorePort } from "../../src/archive/service.js";

const options = {
  vaultRoot: "/fixture", archive: { archiveRoot: "Archive", sourceRoots: ["Income"], minAgeDays: 30, deleteEmptySourceNotes: false },
  statuses: [{ symbol: "x", name: "Done", type: "DONE" as const }], asOf: "2026-10-06", apply: true,
};
class MemoryStore implements ArchiveStorePort {
  readonly sources = new Map([["Income/day.md", "# Day\n- [x] old ✅ 2026-01-01\n- [x] newer ✅ 2026-10-01\n"]]);
  readonly archive = new Map<string, string>();
  failDestination = false;
  failSource = false;
  async readSources() { return [...this.sources].map(([relative, text]) => ({ relative, text, identity: `id:${text.length}` })); }
  async readArchive(relative: string) { return this.archive.get(relative); }
  async writeArchive(relative: string, text: string) { if (this.failDestination) throw new Error("destination fail"); this.archive.set(relative, text); }
  async commitSource(edit: { path: string; before: string; after: string; deleteNote: boolean }, identity: string) {
    if (this.failSource) throw new Error("source fail");
    const current = this.sources.get(edit.path); if (current !== edit.before || identity !== `id:${current.length}`) throw new Error("changed");
    if (edit.deleteNote) this.sources.delete(edit.path); else this.sources.set(edit.path, edit.after);
  }
}

test("writes archive before source and maps full source-relative path", async () => {
  const store = new MemoryStore();
  const result = await archiveDone(options, store);
  assert.equal(result.archived, 1); assert.equal(result.partial, false);
  assert.equal(result.items[0]?.status, "archived");
  assert.equal(result.items[0]?.deleteSourceNote, false);
  assert.match(result.items[0]?.taskBlocks[0] ?? "", /old/u);
  assert.match(store.archive.get("Archive/Income/day.md") ?? "", /# Day\n- \[x\] old/u);
  assert.doesNotMatch(store.sources.get("Income/day.md") ?? "", /old/u);
  assert.match(store.sources.get("Income/day.md") ?? "", /newer/u);
});
test("destination failure leaves source unchanged and source failure reports partial", async () => {
  const destination = new MemoryStore(); destination.failDestination = true;
  const original = destination.sources.get("Income/day.md");
  const failedDestination = await archiveDone(options, destination);
  assert.equal(failedDestination.archived, 0); assert.equal(failedDestination.partial, true); assert.equal(destination.sources.get("Income/day.md"), original);
  const source = new MemoryStore(); source.failSource = true;
  const failedSource = await archiveDone(options, source);
  assert.equal(failedSource.archived, 0); assert.equal(failedSource.partial, true); assert.match(source.archive.get("Archive/Income/day.md") ?? "", /old/u);
  assert.match(source.sources.get("Income/day.md") ?? "", /old/u);
});
test("dry-run plan is byte-identical", async () => {
  const store = new MemoryStore();
  const result = await archiveDone({ ...options, apply: false }, store);
  assert.equal(result.eligible, 1); assert.equal(result.archived, 0); assert.equal(store.archive.size, 0);
  assert.equal(result.items[0]?.status, "planned");
  assert.match(store.sources.get("Income/day.md") ?? "", /old/u);
});

test("archives a complete source note verbatim before deleting it", async () => {
  const store = new MemoryStore();
  store.sources.set("Income/day.md", "Observation\n# Day\n- [x] old ✅ 2026-01-01\n");
  const result = await archiveDone({ ...options, archive: { ...options.archive, deleteEmptySourceNotes: true } }, store);
  assert.equal(result.deletedSourceNotes, 1);
  assert.equal(result.items[0]?.deleteSourceNote, true);
  assert.equal(store.sources.has("Income/day.md"), false);
  assert.equal(store.archive.get("Archive/Income/day.md"), "Observation\n# Day\n- [x] old ✅ 2026-01-01\n");
});

test("archives a task-free source note before deleting it", async () => {
  const store = new MemoryStore();
  store.sources.set("Income/day.md", "---\ntemplate: daily\n---\n# Empty\n");
  const result = await archiveDone({ ...options, archive: { ...options.archive, deleteEmptySourceNotes: true } }, store);
  assert.equal(result.eligible, 0);
  assert.equal(result.deletedSourceNotes, 1);
  assert.equal(result.items[0]?.deleteSourceNote, true);
  assert.equal(store.sources.has("Income/day.md"), false);
  assert.equal(store.archive.get("Archive/Income/day.md"), "---\ntemplate: daily\n---\n# Empty\n");
});
