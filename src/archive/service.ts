import { constants } from "node:fs";
import { mkdir, open, opendir, lstat, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ArchiveConfig, StatusConfig } from "../config/index.js";
import type { ArchiveBlock, ArchiveWarning, PlannedArchive, SourceEdit } from "./plan.js";
import { planDocument } from "./plan.js";

export interface ArchiveResult {
  readonly asOf: string;
  readonly applied: boolean;
  readonly considered: number;
  readonly eligible: number;
  readonly archived: number;
  readonly skipped: number;
  readonly deletedSourceNotes: number;
  readonly warnings: readonly ArchiveWarning[];
  readonly errors: readonly { readonly code: string; readonly message: string }[];
  /** Full task blocks are intentionally shown for this single-user CLI. */
  readonly items: readonly ArchiveItem[];
  readonly partial: boolean;
}

export interface ArchiveItem {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly taskBlocks: readonly string[];
  /** True means the original note is archived verbatim and then removed. */
  readonly deleteSourceNote: boolean;
  readonly status: "planned" | "archived" | "failed";
  readonly error?: { readonly code: string; readonly message: string };
}

export class ArchiveError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ArchiveError"; }
}

export interface ArchiveServiceOptions {
  readonly vaultRoot: string;
  readonly archive: ArchiveConfig;
  readonly statuses: readonly StatusConfig[];
  readonly asOf: string;
  readonly apply: boolean;
}

export interface ArchiveStorePort {
  readSources(): Promise<readonly ArchiveSource[]>;
  readArchive(relative: string): Promise<string | undefined>;
  writeArchive(relative: string, text: string): Promise<void>;
  commitSource(edit: SourceEdit, identity: string): Promise<void>;
}
export interface ArchiveSource { readonly relative: string; readonly text: string; readonly identity: string; }

/** Archive service with a deliberately narrow, archive-only filesystem surface. */
export async function archiveDone(options: ArchiveServiceOptions, providedStore?: ArchiveStorePort): Promise<ArchiveResult> {
  const store = providedStore ?? await ArchiveStore.open(options.vaultRoot, options.archive);
  const documents = await store.readSources();
  const plans = documents.map((document) => planDocument(
    document.relative, document.text, options.statuses, options.asOf,
    options.archive.minAgeDays, options.archive.deleteEmptySourceNotes,
  ));
  const combined = combinePlans(plans);
  if (!options.apply) return result(options.asOf, false, combined, 0, 0, [], false, combined.sourceEdits.map((edit) => item(edit, options.archive.archiveRoot, "planned")));

  let archived = 0;
  let deletedSourceNotes = 0;
  const errors: Array<{ code: string; message: string }> = [];
  const items: ArchiveItem[] = [];
  const identities = new Map(documents.map((document) => [document.relative, document.identity]));
  for (const edit of combined.sourceEdits) {
    const destination = `${options.archive.archiveRoot}/${edit.path}`;
    try {
      const existing = await store.readArchive(destination);
      let rendered: string;
      if (edit.archiveWholeNote) {
        rendered = existing === undefined ? edit.before : appendNote(existing, edit.before);
      } else {
        rendered = existing ?? "";
        for (const block of edit.blocks) rendered = mergeBlock(rendered, block);
      }
      await store.writeArchive(destination, rendered);
      const identity = identities.get(edit.path);
      if (identity === undefined) throw new ArchiveError("SOURCE_CHANGED", "Source was not part of the archive snapshot");
      await store.commitSource(edit, identity);
      archived += edit.blocks.length;
      if (edit.deleteNote) deletedSourceNotes += 1;
      items.push(item(edit, options.archive.archiveRoot, "archived"));
    } catch (error) {
      const detail = error instanceof ArchiveError
        ? { code: error.code, message: error.message }
        : { code: "ARCHIVE_WRITE_FAILED", message: error instanceof Error ? error.message : "Archive write failed" };
      errors.push(detail);
      items.push({ ...item(edit, options.archive.archiveRoot, "failed"), error: detail });
    }
  }
  return result(options.asOf, true, combined, archived, deletedSourceNotes, errors, errors.length > 0, items);
}

function result(asOf: string, applied: boolean, plan: PlannedArchive, archived: number, deletedSourceNotes: number, errors: readonly { code: string; message: string }[], partial: boolean, items: readonly ArchiveItem[]): ArchiveResult {
  return {
    asOf, applied, considered: plan.considered, eligible: plan.eligible, archived,
    skipped: plan.skipped, deletedSourceNotes, warnings: plan.warnings, errors, items, partial,
  };
}
function combinePlans(plans: readonly PlannedArchive[]): PlannedArchive {
  return {
    sourceEdits: plans.flatMap((plan) => plan.sourceEdits),
    considered: plans.reduce((total, plan) => total + plan.considered, 0),
    eligible: plans.reduce((total, plan) => total + plan.eligible, 0),
    skipped: plans.reduce((total, plan) => total + plan.skipped, 0),
    warnings: plans.flatMap((plan) => plan.warnings),
  };
}
function item(edit: SourceEdit, archiveRoot: string, status: ArchiveItem["status"]): ArchiveItem {
  return {
    sourcePath: edit.path,
    destinationPath: `${archiveRoot}/${edit.path}`,
    taskBlocks: edit.blocks.map((block) => block.text),
    deleteSourceNote: edit.deleteNote,
    status,
  };
}

class ArchiveStore implements ArchiveStorePort {
  private constructor(private readonly root: string, private readonly config: ArchiveConfig) {}

  static async open(vaultRoot: string, config: ArchiveConfig): Promise<ArchiveStore> {
    const rootStatus = await lstat(vaultRoot).catch(() => undefined);
    if (rootStatus === undefined || !rootStatus.isDirectory() || rootStatus.isSymbolicLink()) throw new ArchiveError("INVALID_VAULT_ROOT", "Configured vault root is not a directory");
    return new ArchiveStore(await realpath(vaultRoot), config);
  }

  async readSources(): Promise<Array<ArchiveSource>> {
    const documents: ArchiveSource[] = [];
    for (const sourceRoot of this.config.sourceRoots) await this.walk(sourceRoot, documents);
    return documents.sort((left, right) => left.relative.localeCompare(right.relative));
  }

  async readArchive(relative: string): Promise<string | undefined> {
    const absolute = await this.existingPath(relative, "file", true);
    if (absolute === undefined) return undefined;
    return this.readNoFollow(absolute);
  }

  async writeArchive(relative: string, text: string): Promise<void> {
    const absolute = await this.destinationPath(relative);
    await this.atomicWrite(absolute, text);
  }

  async commitSource(edit: SourceEdit, identity: string): Promise<void> {
    const absolute = await this.existingPath(edit.path, "file", false);
    if (absolute === undefined) throw new ArchiveError("SOURCE_CHANGED", "Source changed during archive run");
    if (await this.identity(absolute) !== identity) throw new ArchiveError("SOURCE_CHANGED", "Source changed during archive run");
    const current = await this.readNoFollow(absolute);
    if (current !== edit.before) throw new ArchiveError("SOURCE_CHANGED", "Source changed during archive run");
    if (await this.identity(absolute) !== identity) throw new ArchiveError("SOURCE_CHANGED", "Source changed during archive run");
    if (edit.deleteNote) {
      await this.validateExistingParents(edit.path);
      await rm(absolute, { force: false });
      await this.pruneEmptySourceParents(edit.path);
    } else await this.atomicWrite(absolute, edit.after);
  }

  private async walk(relative: string, output: ArchiveSource[]): Promise<void> {
    const absolute = await this.existingPath(relative, "directory", false);
    if (absolute === undefined) throw new ArchiveError("INVALID_SOURCE_ROOT", "Configured source root does not exist");
    const directory = await opendir(absolute);
    try {
      for await (const entry of directory) {
        const child = `${relative}/${entry.name}`;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { await this.walk(child, output); continue; }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") continue;
        const safe = await this.existingPath(child, "file", true);
        if (safe !== undefined) output.push({ relative: child, text: await this.readNoFollow(safe), identity: await this.identity(safe) });
      }
    } finally { await directory.close().catch(() => undefined); }
  }

  private async destinationPath(relative: string): Promise<string> {
    const segments = safeSegments(relative);
    const archive = safeSegments(this.config.archiveRoot);
    if (!startsWith(segments, archive)) throw new ArchiveError("DESTINATION_ESCAPE", "Archive destination is outside archive root");
    let current = this.root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      current = path.join(current, segments[index] ?? "");
      const status = await lstat(current).catch(() => undefined);
      if (status === undefined) await mkdir(current);
      else if (!status.isDirectory() || status.isSymbolicLink()) throw new ArchiveError("UNSAFE_PATH", "Archive directory is unsafe");
      const canonical = await realpath(current);
      if (!within(this.root, canonical)) throw new ArchiveError("DESTINATION_ESCAPE", "Archive directory escaped vault");
    }
    const target = path.join(this.root, ...segments);
    const status = await lstat(target).catch(() => undefined);
    if (status?.isSymbolicLink() || (status !== undefined && !status.isFile())) throw new ArchiveError("UNSAFE_PATH", "Archive target is unsafe");
    return target;
  }

  private async existingPath(relative: string, expected: "file" | "directory", optional: boolean): Promise<string | undefined> {
    const segments = safeSegments(relative);
    let current = this.root;
    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index] ?? "");
      const status = await lstat(current).catch(() => undefined);
      if (status === undefined) { if (optional) return undefined; throw new ArchiveError("UNSAFE_PATH", "Configured archive path is missing"); }
      if (status.isSymbolicLink() || (index === segments.length - 1 ? (expected === "file" ? !status.isFile() : !status.isDirectory()) : !status.isDirectory())) {
        throw new ArchiveError("UNSAFE_PATH", "Configured archive path is unsafe");
      }
      if (!within(this.root, await realpath(current))) throw new ArchiveError("PATH_ESCAPE", "Configured archive path escaped vault");
    }
    return current;
  }

  private async validateExistingParents(relative: string): Promise<void> {
    const parts = safeSegments(relative); parts.pop();
    if (parts.length > 0) await this.existingPath(parts.join("/"), "directory", false);
  }

  /** Remove empty descendants but never a configured source root itself. */
  private async pruneEmptySourceParents(relative: string): Promise<void> {
    const sourceRoot = this.sourceRootFor(relative);
    if (sourceRoot === undefined) return;
    const sourceAbsolute = await this.existingPath(sourceRoot, "directory", false);
    if (sourceAbsolute === undefined) return;
    let current = path.dirname(path.join(this.root, ...safeSegments(relative)));
    while (current !== sourceAbsolute) {
      try { await rmdir(current); }
      catch { return; }
      current = path.dirname(current);
    }
  }

  private sourceRootFor(relative: string): string | undefined {
    const segments = safeSegments(relative);
    return [...this.config.sourceRoots]
      .filter((sourceRoot) => startsWith(segments, safeSegments(sourceRoot)))
      .sort((left, right) => right.length - left.length)[0];
  }

  private async readNoFollow(absolute: string): Promise<string> {
    const handle = await open(absolute, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
    try { return await handle.readFile({ encoding: "utf8" }); } finally { await handle.close(); }
  }
  private async identity(absolute: string): Promise<string> {
    const status = await lstat(absolute);
    return `${status.dev}:${status.ino}:${status.size}:${status.mtimeMs}`;
  }
  private async atomicWrite(target: string, text: string): Promise<void> {
    const parent = path.dirname(target);
    const parentStatus = await lstat(parent).catch(() => undefined);
    if (parentStatus === undefined || !parentStatus.isDirectory() || parentStatus.isSymbolicLink() || !within(this.root, await realpath(parent))) throw new ArchiveError("UNSAFE_PATH", "Archive parent is unsafe");
    const parentIdentity = identityOf(parentStatus);
    const temporary = path.join(parent, `.${path.basename(target)}.vault-tasks-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
      const temporaryStatus = await lstat(temporary).catch(() => undefined);
      const currentParent = await lstat(parent).catch(() => undefined);
      if (temporaryStatus === undefined || !temporaryStatus.isFile() || temporaryStatus.isSymbolicLink() || currentParent === undefined || identityOf(currentParent) !== parentIdentity || !within(this.root, await realpath(temporary))) {
        throw new ArchiveError("UNSAFE_PATH", "Archive path changed during write");
      }
      const targetStatus = await lstat(target).catch(() => undefined);
      if (targetStatus?.isSymbolicLink() || (targetStatus !== undefined && !targetStatus.isFile())) throw new ArchiveError("UNSAFE_PATH", "Archive target is unsafe");
      const parentBeforeRename = await lstat(parent).catch(() => undefined);
      if (parentBeforeRename === undefined || identityOf(parentBeforeRename) !== parentIdentity || !within(this.root, await realpath(parent))) throw new ArchiveError("PATH_ESCAPE", "Archive parent escaped vault");
      await rename(temporary, target);
      const finalStatus = await lstat(target).catch(() => undefined);
      if (finalStatus === undefined || !finalStatus.isFile() || finalStatus.isSymbolicLink() || !within(this.root, await realpath(target))) throw new ArchiveError("UNSAFE_PATH", "Archive target changed during write");
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function identityOf(status: { dev: number; ino: number; size: number; mtimeMs: number }): string {
  // Directory size/mtime changes as the temporary file is created; device and
  // inode are the stable identity needed to detect replacement of its parent.
  return `${status.dev}:${status.ino}`;
}

function safeSegments(relative: string): string[] {
  const normalized = relative.replaceAll("\\", "/");
  if (normalized.length === 0 || path.posix.isAbsolute(normalized) || /^[A-Za-z]:/u.test(normalized) || normalized.includes("\0")) throw new ArchiveError("UNSAFE_PATH", "Archive path is invalid");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw new ArchiveError("UNSAFE_PATH", "Archive path is invalid");
  return segments;
}
function within(root: string, candidate: string): boolean { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function startsWith(value: readonly string[], prefix: readonly string[]): boolean { return prefix.every((segment, index) => value[index] === segment); }

function mergeBlock(note: string, block: ArchiveBlock): string {
  const lines = splitLines(note);
  const match = findLastHeadingPath(lines, block.headingPath);
  if (match === undefined) return append(note, [...block.headingLines, block.text].join(""));
  const before = lines.slice(0, match.end).join("");
  const after = lines.slice(match.end).join("");
  return `${ensureEnding(before)}${ensureEnding(block.text)}${after}`;
}
function findLastHeadingPath(lines: readonly string[], target: readonly string[]): { end: number } | undefined {
  let best: { end: number } | undefined;
  const headings: Array<string | undefined> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})[\t ]+(.+?)[\t ]*#*[\t ]*\r?\n?$/u.exec(lines[index] ?? "");
    if (!match) continue;
    const level = match[1]?.length ?? 0; const text = match[2]?.trim();
    if (text === undefined) continue;
    headings.length = level; headings[level - 1] = text;
    if (headings.filter((heading): heading is string => heading !== undefined).join("\u0000") !== target.join("\u0000")) continue;
    let end = index + 1;
    while (end < lines.length) {
      const next = /^(#{1,6})[\t ]+/u.exec(lines[end] ?? "");
      if (next && (next[1]?.length ?? 7) <= level) break;
      end += 1;
    }
    best = { end };
  }
  return best;
}
function splitLines(value: string): string[] { return value === "" ? [] : value.match(/[^\n]*(?:\n|$)/gu)?.filter((line) => line !== "") ?? []; }
function ensureEnding(value: string): string { return value === "" || value.endsWith("\n") ? value : `${value}\n`; }
function append(note: string, addition: string): string { return note === "" ? ensureEnding(addition) : `${ensureEnding(note)}${ensureEnding(addition)}`; }
function appendNote(note: string, addition: string): string { return append(note, addition); }
