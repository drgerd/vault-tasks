import type { StatusConfig } from "../config/index.js";
import type { TaskPriority, VaultTask } from "../model/task.js";

const TASK_LINE = /^(\s*(?:[-+*]|\d+[.)])\s+)\[([^\]\r\n])\](?:\s+(.*)|\s*)$/u;
const HEADING = /^(#{1,6})[\t ]+(.+?)[\t ]*#*[\t ]*$/u;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/u;
const ISO_DATE = "(\\d{4}-\\d{2}-\\d{2})";
const DATE_MARKERS = {
  scheduled: "⏳",
  due: "📅",
  created: "➕",
  start: "🛫",
  done: "✅",
  cancelled: "❌",
} as const;
const PRIORITIES = [
  ["🔺", "highest"],
  ["⏫", "high"],
  ["🔼", "medium"],
  ["🔽", "low"],
  ["⏬", "lowest"],
] as const;
const METADATA_MARKERS = "⏳📅➕🛫✅❌🔺⏫🔼🔽⏬🔁🆔⛔";

export interface ParseMarkdownOptions {
  readonly path: string;
  readonly statuses: readonly StatusConfig[];
}

/** Parse task lines from one Markdown document without reconstructing source text. */
export function parseMarkdownTasks(
  markdown: string,
  options: ParseMarkdownOptions,
): VaultTask[] {
  const statusBySymbol = new Map(options.statuses.map((status) => [status.symbol, status]));
  const headings: Array<string | undefined> = [];
  const tasks: VaultTask[] = [];
  const lines = markdown.split(/\r?\n/u);
  let fence: { marker: "`" | "~"; length: number } | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const fenceMatch = FENCE.exec(rawLine);
    if (fenceMatch) {
      const run = fenceMatch[1];
      if (run !== undefined) {
        const marker = run[0] as "`" | "~";
        if (fence === undefined) {
          fence = { marker, length: run.length };
        } else if (fence.marker === marker && run.length >= fence.length) {
          fence = undefined;
        }
      }
      continue;
    }
    if (fence !== undefined) continue;

    const headingMatch = HEADING.exec(rawLine);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 0;
      const text = headingMatch[2]?.trim();
      if (level > 0 && text !== undefined) {
        headings.length = level;
        headings[level - 1] = text;
      }
      continue;
    }

    const task = parseTaskLine(rawLine, index + 1, options.path, statusBySymbol, headings);
    if (task !== undefined) tasks.push(task);
  }

  return tasks;
}

export function parseTaskLine(
  rawLine: string,
  line: number,
  path: string,
  statuses: ReadonlyMap<string, StatusConfig> | readonly StatusConfig[],
  headingLevels: readonly (string | undefined)[] = [],
): VaultTask | undefined {
  const match = TASK_LINE.exec(rawLine);
  if (!match) return undefined;

  const symbol = match[2] ?? "";
  const body = match[3] ?? "";
  const statusBySymbol: ReadonlyMap<string, StatusConfig> = Array.isArray(statuses)
    ? new Map(statuses.map((status) => [status.symbol, status]))
    : statuses as ReadonlyMap<string, StatusConfig>;
  const configured = statusBySymbol.get(symbol);
  const hierarchy = headingLevels.filter((heading): heading is string => heading !== undefined);
  const dates = extractDates(body);
  const recurrenceRule = extractFollowingText(body, "🔁");
  const taskId = extractToken(body, "🆔");
  const dependsOn = extractFollowingText(body, "⛔")
    ?.split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0) ?? [];

  return {
    path,
    line,
    markdown: rawLine,
    description: stripMetadata(body),
    status: configured === undefined
      ? { symbol, name: "Unknown", type: "UNKNOWN" }
      : { symbol, name: configured.name, type: configured.type },
    dates,
    priority: extractPriority(body),
    tags: extractTags(body),
    heading: {
      nearest: hierarchy.at(-1) ?? null,
      hierarchy,
    },
    recurrence: {
      isRecurring: recurrenceRule !== undefined,
      rule: recurrenceRule ?? null,
    },
    taskId: taskId ?? null,
    dependsOn,
    blockedBy: [],
    blocks: [],
    isBlocked: false,
    isBlocking: false,
  };
}

function extractDates(body: string): VaultTask["dates"] {
  const date = (marker: string): string | null => {
    const match = new RegExp(`${escapeRegExp(marker)}\\s*${ISO_DATE}`, "u").exec(body);
    return match?.[1] ?? null;
  };
  return {
    scheduled: date(DATE_MARKERS.scheduled),
    due: date(DATE_MARKERS.due),
    created: date(DATE_MARKERS.created),
    start: date(DATE_MARKERS.start),
    done: date(DATE_MARKERS.done),
    cancelled: date(DATE_MARKERS.cancelled),
  };
}

function extractPriority(body: string): TaskPriority {
  for (const [marker, priority] of PRIORITIES) {
    if (body.includes(marker)) return priority;
  }
  return "none";
}

function extractTags(body: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  const expression = /(^|[\s(])(#(?:[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*))/gu;
  for (const match of body.matchAll(expression)) {
    const tag = match[2];
    if (tag !== undefined && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function extractToken(body: string, marker: string): string | undefined {
  const match = new RegExp(`${escapeRegExp(marker)}\\s*([^\\s${METADATA_MARKERS}]+)`, "u").exec(body);
  return match?.[1]?.trim() || undefined;
}

function extractFollowingText(body: string, marker: string): string | undefined {
  const start = body.indexOf(marker);
  if (start < 0) return undefined;
  const after = body.slice(start + marker.length).trimStart();
  const next = new RegExp(`[${METADATA_MARKERS}]`, "u").exec(after);
  const value = (next === null ? after : after.slice(0, next.index)).trim();
  return value.length > 0 ? value : undefined;
}

function stripMetadata(body: string): string {
  let description = body;
  for (const marker of Object.values(DATE_MARKERS)) {
    description = description.replace(new RegExp(`\\s*${escapeRegExp(marker)}\\s*${ISO_DATE}`, "gu"), "");
  }
  for (const [marker] of PRIORITIES) {
    description = description.replaceAll(marker, "");
  }
  description = description.replace(new RegExp(`\\s*🔁\\s*[^${METADATA_MARKERS}]*`, "gu"), "");
  description = description.replace(new RegExp(`\\s*🆔\\s*[^\\s${METADATA_MARKERS}]+`, "gu"), "");
  description = description.replace(new RegExp(`\\s*⛔\\s*[^${METADATA_MARKERS}]*`, "gu"), "");
  return description.replace(/\s+/gu, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
