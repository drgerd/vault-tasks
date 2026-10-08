import type { StatusConfig } from "../config/index.js";
import { parseTaskLine } from "../vault/parse-task.js";

export type ArchiveWarningCode = "MISSING_TERMINAL_DATE";

/** Detailed by design: this is a personal CLI, so diagnostics identify the task. */
export interface ArchiveWarning {
  readonly code: ArchiveWarningCode;
  readonly path: string;
  readonly line: number;
  readonly markdown: string;
}

export interface ArchiveBlock {
  readonly headingPath: readonly string[];
  readonly headingLines: readonly string[];
  readonly text: string;
}

export interface SourceEdit {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly blocks: readonly ArchiveBlock[];
  readonly deleteNote: boolean;
  /** When deleting source, preserve every non-task line by archiving the note verbatim. */
  readonly archiveWholeNote: boolean;
}

export interface PlannedArchive {
  readonly sourceEdits: readonly SourceEdit[];
  readonly considered: number;
  readonly eligible: number;
  readonly skipped: number;
  readonly warnings: readonly ArchiveWarning[];
}

interface Heading { readonly text: string; readonly raw: string; }
interface Candidate { readonly start: number; readonly end: number; readonly block: ArchiveBlock; }

/**
 * Pure, line-preserving archive planner.  It deliberately owns no filesystem
 * capability; callers supply one already-read source document at a time.
 */
export function planDocument(
  path: string,
  markdown: string,
  statuses: readonly StatusConfig[],
  asOf: string,
  minAgeDays: number,
  deleteEmptySourceNotes: boolean,
): PlannedArchive {
  const lines = splitLines(markdown);
  const headings: Array<Heading | undefined> = [];
  const candidates: Candidate[] = [];
  const warnings: ArchiveWarning[] = [];
  let considered = 0;
  let fence: { marker: string; length: number } | undefined;
  // Markdown list nesting is relative to another checklist item, not to the
  // document margin: a note may deliberately align every task with one space.
  const checklistIndents: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const line = withoutEol(raw);
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      checklistIndents.length = 0;
      const run = fenceMatch[1] ?? "";
      if (fence === undefined) fence = { marker: run[0] ?? "", length: run.length };
      else if (fence.marker === run[0] && run.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;

    const headingMatch = /^(#{1,6})[\t ]+(.+?)[\t ]*#*[\t ]*$/u.exec(line);
    if (headingMatch) {
      checklistIndents.length = 0;
      const level = headingMatch[1]?.length ?? 0;
      const text = headingMatch[2]?.trim();
      if (level > 0 && text !== undefined) {
        headings.length = level;
        headings[level - 1] = { text, raw };
      }
      continue;
    }

    const task = parseTaskLine(line, index + 1, path, statuses, headings.map((heading) => heading?.text));
    if (task === undefined) {
      if (line.trim() !== "" && indentationOf(line).length === 0) checklistIndents.length = 0;
      continue;
    }
    considered += 1;
    const indentation = indentationOf(line);
    const indentationWidth = indentation.length;
    while ((checklistIndents.at(-1) ?? -1) >= indentationWidth) checklistIndents.pop();
    const isNestedTask = checklistIndents.length > 0;
    checklistIndents.push(indentationWidth);
    const end = blockEnd(lines, index, indentation);
    // A descendant is never separated from its parent. Leading whitespace by
    // itself is valid for a top-level task and is not a nesting signal.
    if (isNestedTask) {
      // Its parent owns this subtree. It is intentionally not independently
      // eligible and produces no diagnostic of its own.
      index = end - 1;
      continue;
    }
    const hasNestedChecklist = nestedChecklistTasks(lines, index + 1, end, indentation.length, statuses, path);
    const terminalDate = task.status.type === "DONE" ? task.dates.done
      : task.status.type === "CANCELLED" ? task.dates.cancelled : null;
    if ((task.status.type === "DONE" || task.status.type === "CANCELLED") && (terminalDate === null || !isIsoDate(terminalDate))) {
      warnings.push({ code: "MISSING_TERMINAL_DATE", path, line: index + 1, markdown: line });
      continue;
    }
    const cutoff = subtractDays(asOf, minAgeDays);
    if (terminalDate === null || terminalDate > cutoff) {
      if (hasNestedChecklist) index = end - 1;
      continue;
    }
    const activeHeadings = headings.filter((heading): heading is Heading => heading !== undefined);
    candidates.push({
      start: index,
      end,
      block: {
        headingPath: activeHeadings.map((heading) => heading.text),
        headingLines: activeHeadings.map((heading) => heading.raw),
        text: lines.slice(index, end).join(""),
      },
    });
    // This root owns all descendant checklists in the copied raw block; their
    // own status, dates and text do not affect the archive decision.
    if (hasNestedChecklist) index = end - 1;
  }

  const remove = new Set<number>();
  for (const candidate of candidates) for (let index = candidate.start; index < candidate.end; index += 1) remove.add(index);
  const after = lines.filter((_, index) => !remove.has(index)).join("");
  if (candidates.length === 0 && deleteEmptySourceNotes && !containsChecklistTask(markdown, statuses, path)) {
    return {
      sourceEdits: [{ path, before: markdown, after: markdown, blocks: [], deleteNote: true, archiveWholeNote: true }],
      considered,
      eligible: 0,
      skipped: considered,
      warnings,
    };
  }
  const deleteNote = deleteEmptySourceNotes && !containsChecklistTask(after, statuses, path);
  return {
    sourceEdits: candidates.length === 0 ? [] : [{
      path, before: markdown, after, blocks: candidates.map((candidate) => candidate.block), deleteNote, archiveWholeNote: deleteNote,
    }],
    considered,
    eligible: candidates.length,
    skipped: considered - candidates.length,
    warnings,
  };
}

export function subtractDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function splitLines(value: string): string[] {
  if (value === "") return [];
  return value.match(/[^\n]*(?:\n|$)/gu)?.filter((line) => line !== "") ?? [];
}
function withoutEol(value: string): string { return value.endsWith("\n") ? value.slice(0, -1).replace(/\r$/u, "") : value; }
function indentationOf(value: string): string { return /^[ \t]*/u.exec(value)?.[0] ?? ""; }
function blockEnd(lines: readonly string[], start: number, parentIndent: string): number {
  let end = start + 1;
  while (end < lines.length) {
    const line = withoutEol(lines[end] ?? "");
    if (line.trim() === "") { end += 1; continue; }
    if (indentationOf(line).length > parentIndent.length) { end += 1; continue; }
    break;
  }
  return end;
}
function nestedChecklistTasks(lines: readonly string[], from: number, end: number, parentIndent: number, statuses: readonly StatusConfig[], path: string): boolean {
  let fence: { marker: string; length: number } | undefined;
  for (let index = from; index < end; index += 1) {
    const line = withoutEol(lines[index] ?? "");
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      const run = fenceMatch[1] ?? "";
      if (fence === undefined) fence = { marker: run[0] ?? "", length: run.length };
      else if (fence.marker === run[0] && run.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    if (indentationOf(line).length <= parentIndent) continue;
    if (parseTaskLine(line, index + 1, path, statuses) !== undefined) return true;
  }
  return false;
}
function containsChecklistTask(markdown: string, statuses: readonly StatusConfig[], path: string): boolean {
  let fence: { marker: string; length: number } | undefined;
  for (const [index, raw] of splitLines(markdown).entries()) {
    const line = withoutEol(raw);
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      const run = fenceMatch[1] ?? "";
      if (fence === undefined) fence = { marker: run[0] ?? "", length: run.length };
      else if (fence.marker === run[0] && run.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence === undefined && parseTaskLine(line, index + 1, path, statuses) !== undefined) return true;
  }
  return false;
}
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
