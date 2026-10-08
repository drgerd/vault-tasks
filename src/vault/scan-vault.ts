import path from "node:path";

import type { ScanConfig, StatusConfig } from "../config/index.js";
import type { VaultTask } from "../model/task.js";
import { NodeFileSource, type EntryIdentity, type FileEntry, type FileIdentity, type FileSource } from "./file-source.js";
import { parseMarkdownTasks } from "./parse-task.js";

export type VaultScanWarningCode =
  | "EXCLUDED_DIRECTORY"
  | "SYMLINK_SKIPPED"
  | "NON_REGULAR_SKIPPED"
  | "PATH_ESCAPE_SKIPPED"
  | "OVERSIZED_FILE_SKIPPED"
  | "FILE_CHANGED_SKIPPED"
  | "FILE_READ_FAILED";

export interface VaultScanWarning {
  readonly code: VaultScanWarningCode;
  readonly path: string;
  readonly message: string;
}

export interface VaultScanResult {
  readonly tasks: readonly VaultTask[];
  readonly filesScanned: number;
  readonly bytesRead: number;
  readonly warnings: readonly VaultScanWarning[];
}

export type VaultScanErrorCode =
  | "INVALID_VAULT_ROOT"
  | "VAULT_ROOT_SYMLINK"
  | "INVALID_EXCLUDED_DIRECTORY"
  | "MAX_FILES_EXCEEDED"
  | "MAX_TOTAL_BYTES_EXCEEDED";

export class VaultScanError extends Error {
  constructor(
    readonly code: VaultScanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VaultScanError";
  }
}

export interface ScanVaultOptions {
  readonly vaultRoot: string;
  readonly statuses: readonly StatusConfig[];
  readonly scan: ScanConfig;
  readonly fileSource?: FileSource;
}

/** Safely discover and parse Markdown tasks without following filesystem links. */
export async function scanVault(options: ScanVaultOptions): Promise<VaultScanResult> {
  const source = options.fileSource ?? new NodeFileSource();
  if (!path.isAbsolute(options.vaultRoot)) {
    throw new VaultScanError("INVALID_VAULT_ROOT", "The configured vault root must be absolute");
  }
  const rootKind = await source.lstatKind(options.vaultRoot).catch(() => undefined);
  if (rootKind === "symlink") {
    throw new VaultScanError("VAULT_ROOT_SYMLINK", "The configured vault root must not be a symlink");
  }
  if (rootKind !== "directory") {
    throw new VaultScanError("INVALID_VAULT_ROOT", "The configured vault root must be an existing directory");
  }

  const canonicalRoot = await source.realpath(options.vaultRoot);
  if (await source.statKind(canonicalRoot) !== "directory") {
    throw new VaultScanError("INVALID_VAULT_ROOT", "The configured vault root must resolve to a directory");
  }
  const exclusions = normalizeExclusions(options.scan.excludedDirectories);
  const candidates: Array<{ absolute: string; relative: string }> = [];
  const warnings: VaultScanWarning[] = [];
  let visitedEntries = 0;

  await walk(canonicalRoot, "");
  candidates.sort((left, right) => compareText(left.relative, right.relative));

  const tasks: VaultTask[] = [];
  let filesScanned = 0;
  let bytesRead = 0;
  for (const candidate of candidates) {
    let opened;
    try {
      const containment = await validateEntry(source, canonicalRoot, candidate.absolute, candidate.relative, "file");
      if (containment !== undefined) {
        warnings.push(containment);
        continue;
      }
      const before = await source.lstatIdentity(candidate.absolute);
      opened = await source.openReadOnlyNoFollow(candidate.absolute);
      const after = await opened.stat();
      if (!sameIdentity(before, after) || !after.isFile) {
        warnings.push(warning("FILE_CHANGED_SKIPPED", candidate.relative, "File changed while opening and was skipped"));
        continue;
      }
      const afterOpenValidation = await validateOpenedPath(source, canonicalRoot, candidate, after);
      if (afterOpenValidation !== undefined) {
        warnings.push(afterOpenValidation);
        continue;
      }
      if (after.size > options.scan.maxFileBytes) {
        warnings.push(warning("OVERSIZED_FILE_SKIPPED", candidate.relative, "Markdown file exceeds maxFileBytes and was skipped"));
        continue;
      }
      if (bytesRead + after.size > options.scan.maxTotalBytes) {
        throw new VaultScanError("MAX_TOTAL_BYTES_EXCEEDED", "Markdown input exceeds maxTotalBytes");
      }
      const read = await opened.readUtf8(options.scan.maxFileBytes);
      const finalIdentity = await opened.stat();
      const afterReadValidation = await validateOpenedPath(source, canonicalRoot, candidate, finalIdentity);
      if (afterReadValidation !== undefined) {
        warnings.push(afterReadValidation);
        continue;
      }
      if (!sameIdentity(after, finalIdentity) || !finalIdentity.isFile) {
        warnings.push(warning("FILE_CHANGED_SKIPPED", candidate.relative, "File changed while reading and was skipped"));
        continue;
      }
      if (read.overflow) {
        warnings.push(warning("OVERSIZED_FILE_SKIPPED", candidate.relative, "Markdown file grew beyond maxFileBytes while reading and was skipped"));
        continue;
      }
      const actualBytes = read.bytesRead;
      if (actualBytes > options.scan.maxFileBytes) {
        warnings.push(warning("OVERSIZED_FILE_SKIPPED", candidate.relative, "Markdown file exceeds maxFileBytes and was skipped"));
        continue;
      }
      if (bytesRead + actualBytes > options.scan.maxTotalBytes) {
        throw new VaultScanError("MAX_TOTAL_BYTES_EXCEEDED", "Markdown input exceeds maxTotalBytes");
      }
      bytesRead += actualBytes;
      filesScanned += 1;
      tasks.push(...parseMarkdownTasks(read.text, {
        path: candidate.relative,
        statuses: options.statuses,
      }));
    } catch (error) {
      if (error instanceof VaultScanError) throw error;
      warnings.push(warning("FILE_READ_FAILED", candidate.relative, "Markdown file could not be read and was skipped"));
    } finally {
      await opened?.close().catch(() => undefined);
    }
  }

  return { tasks, filesScanned, bytesRead, warnings };

  async function walk(absoluteDirectory: string, relativeDirectory: string): Promise<void> {
    const before = await captureDirectory(source, canonicalRoot, absoluteDirectory, relativeDirectory);
    if ("warning" in before) {
      warnings.push(before.warning);
      return;
    }
    const entries: FileEntry[] = [];
    for await (const entry of source.list(absoluteDirectory)) {
      visitedEntries += 1;
      if (visitedEntries > options.scan.maxFiles) {
        throw new VaultScanError("MAX_FILES_EXCEEDED", "Filesystem entry count exceeds maxFiles");
      }
      entries.push(entry);
    }
    const after = await captureDirectory(source, canonicalRoot, absoluteDirectory, relativeDirectory);
    if (
      "warning" in after
      || !sameNode(before.identity, after.identity)
      || before.canonical !== after.canonical
    ) {
      warnings.push("warning" in after
        ? after.warning
        : warning("FILE_CHANGED_SKIPPED", relativeDirectory || ".", "Directory changed while listing and its entries were discarded"));
      return;
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const relative = toPosix(relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`);
      const absolute = path.join(absoluteDirectory, entry.name);
      if (!isWithinRoot(canonicalRoot, absolute)) continue;

      if (entry.kind === "symlink") {
        warnings.push(warning("SYMLINK_SKIPPED", relative, "Symbolic link was not followed"));
        continue;
      }
      if (entry.kind === "directory") {
        if (isExcluded(relative, entry.name, exclusions)) {
          warnings.push(warning("EXCLUDED_DIRECTORY", relative, "Configured directory was skipped"));
        } else {
          await walk(absolute, relative);
        }
        continue;
      }
      if (entry.kind !== "file") {
        warnings.push(warning("NON_REGULAR_SKIPPED", relative, "Non-regular filesystem entry was skipped"));
        continue;
      }
      if (path.extname(entry.name).toLowerCase() !== ".md") continue;
      candidates.push({ absolute, relative });
    }
  }
}

type DirectoryCapture =
  | { readonly identity: EntryIdentity; readonly canonical: string }
  | { readonly warning: VaultScanWarning };

async function captureDirectory(
  source: FileSource,
  canonicalRoot: string,
  absolute: string,
  relative: string,
): Promise<DirectoryCapture> {
  if (relative !== "") {
    const containment = await validateEntry(source, canonicalRoot, absolute, relative, "directory");
    if (containment !== undefined) return { warning: containment };
  }
  try {
    const identity = await source.lstatIdentity(absolute);
    const canonical = await source.realpath(absolute);
    if (identity.kind !== "directory") {
      return { warning: warning("FILE_CHANGED_SKIPPED", relative || ".", "Directory type changed and was skipped") };
    }
    if (relative === "" ? canonical !== canonicalRoot : !isWithinRoot(canonicalRoot, canonical)) {
      return { warning: warning("PATH_ESCAPE_SKIPPED", relative || ".", "Directory resolves outside the vault and was skipped") };
    }
    return { identity, canonical };
  } catch {
    return { warning: warning("FILE_CHANGED_SKIPPED", relative || ".", "Directory changed during validation and was skipped") };
  }
}

async function validateOpenedPath(
  source: FileSource,
  canonicalRoot: string,
  candidate: { readonly absolute: string; readonly relative: string },
  openedIdentity: FileIdentity,
): Promise<VaultScanWarning | undefined> {
  const containment = await validateEntry(source, canonicalRoot, candidate.absolute, candidate.relative, "file");
  if (containment !== undefined) return containment;
  try {
    const pathIdentity = await source.lstatIdentity(candidate.absolute);
    if (pathIdentity.kind !== "file" || !sameIdentity(pathIdentity, openedIdentity)) {
      return warning("FILE_CHANGED_SKIPPED", candidate.relative, "Opened file no longer matches its vault path and was skipped");
    }
  } catch {
    return warning("FILE_CHANGED_SKIPPED", candidate.relative, "Opened file path changed during validation and was skipped");
  }
  return undefined;
}

async function validateEntry(
  source: FileSource,
  canonicalRoot: string,
  absolute: string,
  relative: string,
  expectedKind: "file" | "directory",
): Promise<VaultScanWarning | undefined> {
  const segments = relative.split("/");
  let current = canonicalRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index] ?? "");
    let kind;
    try {
      kind = await source.lstatKind(current);
    } catch {
      return warning("FILE_CHANGED_SKIPPED", relative, "Filesystem entry changed before access and was skipped");
    }
    if (kind === "symlink") {
      return warning("SYMLINK_SKIPPED", relative, "Symbolic link in the source path was not followed");
    }
    const expected = index === segments.length - 1 ? expectedKind : "directory";
    if (kind !== expected) {
      return warning("FILE_CHANGED_SKIPPED", relative, "Filesystem entry type changed before access and was skipped");
    }
  }
  try {
    const canonical = await source.realpath(absolute);
    if (!isWithinRoot(canonicalRoot, canonical)) {
      return warning("PATH_ESCAPE_SKIPPED", relative, "Filesystem entry resolves outside the vault and was skipped");
    }
  } catch {
    return warning("FILE_CHANGED_SKIPPED", relative, "Filesystem entry changed before canonical validation and was skipped");
  }
  return undefined;
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return sameNode(left, right) && left.size === right.size;
}

function sameNode(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function normalizeExclusions(values: readonly string[]): readonly string[] {
  return values.map((value) => {
    const normalized = toPosix(value).replace(/\/$/u, "");
    if (
      normalized.length === 0
      || path.posix.isAbsolute(normalized)
      || /^[A-Za-z]:/u.test(normalized)
      || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
      || normalized.includes("\0")
    ) {
      throw new VaultScanError("INVALID_EXCLUDED_DIRECTORY", "Excluded directories must be safe vault-relative paths or names");
    }
    return normalized;
  });
}

function isExcluded(relative: string, name: string, exclusions: readonly string[]): boolean {
  return exclusions.some((excluded) => excluded.includes("/")
    ? relative === excluded || relative.startsWith(`${excluded}/`)
    : name === excluded);
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function warning(code: VaultScanWarningCode, relativePath: string, message: string): VaultScanWarning {
  return { code, path: relativePath, message };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
