import { TASK_DATE_FIELDS, type DateFilter, type QueryFragment, type TaskDateField, type VaultTaskQuery } from "../model/index.js";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET = /^([+-])(\d+)d$/;
export const MAX_RELATIVE_DAYS = 1_000_000;

function parseIso(value: string): Date {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error(`Invalid date expression: ${value}`);
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid date expression: ${value}`);
  return date;
}

function format(date: Date): string { return date.toISOString().slice(0, 10); }

export function resolveDateExpression(expression: string, asOf: string): string {
  if (ISO_DATE.test(expression)) return format(parseIso(expression));
  const base = parseIso(asOf);
  const aliases: Readonly<Record<string, number>> = { yesterday: -1, today: 0, tomorrow: 1 };
  let delta = aliases[expression];
  if (delta === undefined) {
    const match = OFFSET.exec(expression);
    if (!match) throw new Error(`Invalid date expression: ${expression}`);
    const magnitude = Number(match[2]);
    if (!Number.isSafeInteger(magnitude) || magnitude > MAX_RELATIVE_DAYS) {
      throw new Error(`Relative date offset exceeds ${MAX_RELATIVE_DAYS} days`);
    }
    delta = magnitude * (match[1] === "-" ? -1 : 1);
  }
  base.setUTCDate(base.getUTCDate() + delta);
  if (!Number.isFinite(base.getTime()) || base.getUTCFullYear() < 0 || base.getUTCFullYear() > 9999) {
    throw new Error(`Date expression is outside the supported ISO date range: ${expression}`);
  }
  return format(base);
}

export interface ResolvedDateRange { from?: string; to?: string; fromInclusive: boolean; toInclusive: boolean; missing?: boolean }

export function resolveDateRange(range: DateFilter, asOf: string): ResolvedDateRange {
  if (range.missing === true && (range.from !== undefined || range.to !== undefined)) {
    throw new Error("A date filter with missing=true cannot contain bounds");
  }
  const resolved: ResolvedDateRange = {
    fromInclusive: range.fromInclusive ?? true,
    toInclusive: range.toInclusive ?? true,
  };
  if (range.from !== undefined) resolved.from = resolveDateExpression(range.from, asOf);
  if (range.to !== undefined) resolved.to = resolveDateExpression(range.to, asOf);
  if (range.missing !== undefined) resolved.missing = range.missing;
  if (resolved.from !== undefined && resolved.to !== undefined && resolved.from > resolved.to) {
    throw new Error("Date range from must not be after to");
  }
  return resolved;
}

export function matchesDateRange(value: string | null, range: DateFilter, asOf: string): boolean {
  return matchesResolvedDateRange(value, resolveDateRange(range, asOf));
}

export function matchesResolvedDateRange(value: string | null, resolved: ResolvedDateRange): boolean {
  if (resolved.from === undefined && resolved.to === undefined && resolved.missing === undefined) return true;
  if (resolved.missing === true) return value === null;
  if (resolved.missing === false && value === null) return false;
  if (value === null) return false;
  if (resolved.from !== undefined && (resolved.fromInclusive ? value < resolved.from : value <= resolved.from)) return false;
  if (resolved.to !== undefined && (resolved.toInclusive ? value > resolved.to : value >= resolved.to)) return false;
  return true;
}

export interface ResolvedQueryDateRanges {
  root: Readonly<Partial<Record<TaskDateField, ResolvedDateRange>>>;
  anyOf: readonly Readonly<Partial<Record<TaskDateField, ResolvedDateRange>>>[];
}

function resolveFragmentDateRanges(fragment: QueryFragment, asOf: string): Partial<Record<TaskDateField, ResolvedDateRange>> {
  const result: Partial<Record<TaskDateField, ResolvedDateRange>> = {};
  for (const field of TASK_DATE_FIELDS) {
    const range = fragment[field];
    if (range !== undefined) result[field] = resolveDateRange(range, asOf);
  }
  return result;
}

/** Resolve and validate all query date ranges once, including OR fragments. */
export function resolveQueryDateRanges(query: VaultTaskQuery, asOf: string): ResolvedQueryDateRanges {
  return {
    root: resolveFragmentDateRanges(query, asOf),
    anyOf: (query.anyOf ?? []).map((fragment) => resolveFragmentDateRanges(fragment, asOf)),
  };
}
