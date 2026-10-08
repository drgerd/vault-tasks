import assert from "node:assert/strict";
import { appendFile, mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { NodeFileSource, type OpenedFile } from "../../src/vault/file-source.js";
import { scanVault, VaultScanError } from "../../src/vault/scan-vault.js";

const statuses = [{ symbol: " ", name: "Todo", type: "TODO" as const }];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function vault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vault-tasks-scan-"));
  roots.push(root);
  return root;
}

const limits = {
  excludedDirectories: [".obsidian", ".trash"],
  maxFiles: 10,
  maxFileBytes: 1_024,
  maxTotalBytes: 8_192,
};

test("scans only regular Markdown in deterministic path order", async () => {
  const root = await vault();
  await mkdir(path.join(root, "Folder"));
  await mkdir(path.join(root, ".obsidian"));
  await writeFile(path.join(root, "z.md"), "- [ ] z");
  await writeFile(path.join(root, "Folder", "a.md"), "# A\n- [ ] a");
  await writeFile(path.join(root, "ignored.txt"), "- [ ] not markdown");
  await writeFile(path.join(root, ".obsidian", "private.md"), "- [ ] excluded");

  const result = await scanVault({ vaultRoot: root, statuses, scan: limits });

  assert.deepEqual(result.tasks.map((task) => task.path), ["Folder/a.md", "z.md"]);
  assert.equal(result.filesScanned, 2);
  assert.ok(result.bytesRead > 0);
  assert.equal(result.warnings.some((warning) => warning.code === "EXCLUDED_DIRECTORY"), true);
});

test("does not follow file, directory, or root symlinks", async (context) => {
  if (process.platform === "win32") context.skip("symlink creation is not generally available");
  const root = await vault();
  const outside = await vault();
  await writeFile(path.join(outside, "secret.md"), "- [ ] secret");
  await symlink(path.join(outside, "secret.md"), path.join(root, "file.md"));
  await symlink(outside, path.join(root, "directory"));

  const result = await scanVault({ vaultRoot: root, statuses, scan: limits });
  assert.equal(result.tasks.length, 0);
  assert.equal(result.warnings.filter((warning) => warning.code === "SYMLINK_SKIPPED").length, 2);

  const rootLink = path.join(path.dirname(root), `${path.basename(root)}-link`);
  await symlink(root, rootLink);
  roots.push(rootLink);
  await assert.rejects(
    scanVault({ vaultRoot: rootLink, statuses, scan: limits }),
    (error: unknown) => error instanceof VaultScanError && error.code === "VAULT_ROOT_SYMLINK",
  );
});

test("revalidates intermediate directories immediately before traversal", async (context) => {
  if (process.platform === "win32") context.skip("symlink creation is not generally available");
  const root = await vault();
  const outside = await vault();
  const racedDirectory = path.join(root, "raced");
  await mkdir(racedDirectory);
  await writeFile(path.join(racedDirectory, "safe.md"), "- [ ] safe");
  await writeFile(path.join(outside, "secret.md"), "- [ ] secret");

  class DirectoryRaceSource extends NodeFileSource {
    private raced = false;
    override async *list(directory: string) {
      for await (const entry of super.list(directory)) yield entry;
      if (!this.raced && path.basename(directory) === "raced") {
        this.raced = true;
        await rm(racedDirectory, { recursive: true });
        await symlink(outside, racedDirectory);
      }
    }
  }

  const result = await scanVault({
    vaultRoot: root,
    statuses,
    scan: limits,
    fileSource: new DirectoryRaceSource(),
  });
  assert.equal(result.tasks.length, 0);
  assert.equal(result.warnings.some((warning) => warning.code === "SYMLINK_SKIPPED"), true);
});

test("skips oversized files and aborts at hard file and total-byte ceilings", async () => {
  const root = await vault();
  await writeFile(path.join(root, "large.md"), `- [ ] ${"x".repeat(100)}`);
  const oversized = await scanVault({
    vaultRoot: root,
    statuses,
    scan: { ...limits, maxFileBytes: 20 },
  });
  assert.equal(oversized.filesScanned, 0);
  assert.equal(oversized.warnings[0]?.code, "OVERSIZED_FILE_SKIPPED");

  await writeFile(path.join(root, "second.md"), "- [ ] second");
  await assert.rejects(
    scanVault({ vaultRoot: root, statuses, scan: { ...limits, maxFiles: 1 } }),
    (error: unknown) => error instanceof VaultScanError && error.code === "MAX_FILES_EXCEEDED",
  );
  await assert.rejects(
    scanVault({ vaultRoot: root, statuses, scan: { ...limits, maxFileBytes: 1_024, maxTotalBytes: 5 } }),
    (error: unknown) => error instanceof VaultScanError && error.code === "MAX_TOTAL_BYTES_EXCEEDED",
  );
});

test("counts every visited filesystem entry toward maxFiles", async () => {
  const root = await vault();
  await writeFile(path.join(root, "one.txt"), "not markdown");
  await writeFile(path.join(root, "two.txt"), "not markdown either");
  await writeFile(path.join(root, "tasks.md"), "- [ ] task");

  await assert.rejects(
    scanVault({ vaultRoot: root, statuses, scan: { ...limits, maxFiles: 2 } }),
    (error: unknown) => error instanceof VaultScanError && error.code === "MAX_FILES_EXCEEDED",
  );
});

test("stops streaming a huge directory as soon as maxFiles is exceeded", async () => {
  const root = await vault();
  class HugeDirectorySource extends NodeFileSource {
    yielded = 0;
    override async *list() {
      for (let index = 0; index < 10_000; index += 1) {
        this.yielded += 1;
        yield { name: `entry-${index}`, kind: "other" as const };
      }
    }
  }
  const source = new HugeDirectorySource();
  await assert.rejects(
    scanVault({ vaultRoot: root, statuses, scan: { ...limits, maxFiles: 3 }, fileSource: source }),
    (error: unknown) => error instanceof VaultScanError && error.code === "MAX_FILES_EXCEEDED",
  );
  assert.equal(source.yielded, 4);
});

test("bounds a read when a file grows after its initial stat", async () => {
  const root = await vault();
  const growing = path.join(root, "growing.md");
  await writeFile(growing, "- [ ] initial");

  let requestedLimit = 0;
  let observedBytes = 0;
  class GrowingFileSource extends NodeFileSource {
    private grew = false;
    override async openReadOnlyNoFollow(file: string): Promise<OpenedFile> {
      const opened = await super.openReadOnlyNoFollow(file);
      return {
        stat: () => opened.stat(),
        close: () => opened.close(),
        readUtf8: async (maxBytes) => {
          requestedLimit = maxBytes;
          if (!this.grew) {
            this.grew = true;
            await appendFile(file, "x".repeat(maxBytes * 4));
          }
          const result = await opened.readUtf8(maxBytes);
          observedBytes = result.bytesRead;
          return result;
        },
      };
    }
  }

  const result = await scanVault({
    vaultRoot: root,
    statuses,
    scan: { ...limits, maxFileBytes: 64 },
    fileSource: new GrowingFileSource(),
  });
  assert.equal(result.filesScanned, 0);
  assert.equal(result.tasks.length, 0);
  assert.equal(requestedLimit, 64);
  assert.equal(observedBytes, 65);
  assert.equal(result.warnings.some((warning) =>
    warning.code === "OVERSIZED_FILE_SKIPPED" || warning.code === "FILE_CHANGED_SKIPPED"), true);
});

test("discards an opened descriptor when its path is swapped outside the vault", async (context) => {
  if (process.platform === "win32") context.skip("symlink creation is not generally available");
  const root = await vault();
  const outside = await vault();
  await writeFile(path.join(root, "task.md"), "- [ ] safe");
  await writeFile(path.join(outside, "secret.md"), "- [ ] secret");

  class PostOpenRaceSource extends NodeFileSource {
    private raced = false;
    override async openReadOnlyNoFollow(file: string): Promise<OpenedFile> {
      const opened = await super.openReadOnlyNoFollow(file);
      return {
        close: () => opened.close(),
        readUtf8: (maxBytes) => opened.readUtf8(maxBytes),
        stat: async () => {
          const identity = await opened.stat();
          if (!this.raced) {
            this.raced = true;
            await rename(file, `${file}.moved`);
            await symlink(path.join(outside, "secret.md"), file);
          }
          return identity;
        },
      };
    }
  }

  const result = await scanVault({ vaultRoot: root, statuses, scan: limits, fileSource: new PostOpenRaceSource() });
  assert.equal(result.tasks.length, 0);
  assert.equal(result.warnings.some((warning) => warning.code === "SYMLINK_SKIPPED"), true);
});

test("discards read content when its path changes before post-read validation", async (context) => {
  if (process.platform === "win32") context.skip("symlink creation is not generally available");
  const root = await vault();
  const outside = await vault();
  await writeFile(path.join(root, "task.md"), "- [ ] safe");
  await writeFile(path.join(outside, "secret.md"), "- [ ] secret");

  class PostReadRaceSource extends NodeFileSource {
    private raced = false;
    override async openReadOnlyNoFollow(file: string): Promise<OpenedFile> {
      const opened = await super.openReadOnlyNoFollow(file);
      return {
        close: () => opened.close(),
        stat: () => opened.stat(),
        readUtf8: async (maxBytes) => {
          const result = await opened.readUtf8(maxBytes);
          if (!this.raced) {
            this.raced = true;
            await rename(file, `${file}.moved`);
            await symlink(path.join(outside, "secret.md"), file);
          }
          return result;
        },
      };
    }
  }

  const result = await scanVault({ vaultRoot: root, statuses, scan: limits, fileSource: new PostReadRaceSource() });
  assert.equal(result.tasks.length, 0);
  assert.equal(result.warnings.some((warning) => warning.code === "SYMLINK_SKIPPED"), true);
});

test("rejects unsafe excluded-directory configuration", async () => {
  const root = await vault();
  await assert.rejects(
    scanVault({ vaultRoot: root, statuses, scan: { ...limits, excludedDirectories: ["../outside"] } }),
    (error: unknown) => error instanceof VaultScanError && error.code === "INVALID_EXCLUDED_DIRECTORY",
  );
});
