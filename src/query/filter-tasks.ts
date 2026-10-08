import { matchesResolvedDateRange, resolveQueryDateRanges, type ResolvedDateRange } from "./dates.js";
import { PRIORITY_RANK, TASK_DATE_FIELDS, type QueryFragment, type TaskDateField, type VaultTaskQuery } from "../model/index.js";
import type { EnrichedTask } from "./types.js";

function nonEmptyAny<T>(values: readonly T[] | undefined, predicate: (value: T) => boolean): boolean {
  return values === undefined || values.some(predicate);
}

function matchesFragment(task: EnrichedTask, query: QueryFragment, dates: Readonly<Partial<Record<TaskDateField, ResolvedDateRange>>>): boolean {
  const heading = query.heading;
  if (heading !== undefined) {
    const nearest = task.heading.nearest;
    if (heading.missing === true && nearest !== null) return false;
    if (heading.missing === false && nearest === null) return false;
    if (!nonEmptyAny(heading.anyOf, (wanted) => nearest !== null && normalizeHeading(nearest) === normalizeHeading(wanted))) return false;
    if (!nonEmptyAny(heading.containsAny, (wanted) => nearest !== null && nearest.toLocaleLowerCase().includes(wanted.toLocaleLowerCase()))) return false;
  }

  const status = query.status;
  if (status !== undefined) {
    if (!nonEmptyAny(status.anyOf, (value) => task.status.type === value)) return false;
    if (!nonEmptyAny(status.symbols, (value) => task.status.symbol === value)) return false;
  }

  const tags = query.tags;
  if (tags !== undefined) {
    if (tags.missing === true && task.tags.length !== 0) return false;
    if (tags.missing === false && task.tags.length === 0) return false;
    if (!nonEmptyAny(tags.anyOf, (tag) => task.tags.includes(tag))) return false;
    if (tags.allOf !== undefined && !tags.allOf.every((tag) => task.tags.includes(tag))) return false;
    if (tags.noneOf !== undefined && tags.noneOf.some((tag) => task.tags.includes(tag))) return false;
  }

  for (const field of TASK_DATE_FIELDS) {
    const range = dates[field];
    if (range !== undefined && !matchesResolvedDateRange(task.dates[field], range)) return false;
  }

  const priority = query.priority;
  if (priority !== undefined) {
    if (!nonEmptyAny(priority.anyOf, (value) => task.priority === value)) return false;
    if (priority.atLeast !== undefined && PRIORITY_RANK[task.priority] < PRIORITY_RANK[priority.atLeast]) return false;
    if (priority.atMost !== undefined && PRIORITY_RANK[task.priority] > PRIORITY_RANK[priority.atMost]) return false;
  }

  const recurrence = query.recurrence;
  if (recurrence !== undefined) {
    if (recurrence.state === "only" && !task.recurrence.isRecurring) return false;
    if (recurrence.state === "exclude" && task.recurrence.isRecurring) return false;
    if (recurrence.contains !== undefined && (task.recurrence.rule === null || !task.recurrence.rule.toLocaleLowerCase().includes(recurrence.contains.toLocaleLowerCase()))) return false;
  }

  const source = query.source;
  if (source !== undefined) {
    if (!nonEmptyAny(source.pathsAny, (path) => task.path === path)) return false;
    if (!nonEmptyAny(source.pathPrefixesAny, (prefix) => task.path === prefix || task.path.startsWith(`${prefix}/`))) return false;
    const fileName = task.path.slice(task.path.lastIndexOf("/") + 1);
    if (!nonEmptyAny(source.fileNamesAny, (name) => fileName === name)) return false;
  }

  const id = query.id;
  if (id !== undefined) {
    if (id.present === true && task.taskId === null) return false;
    if (id.present === false && task.taskId !== null) return false;
    if (!nonEmptyAny(id.anyOf, (value) => task.taskId === value)) return false;
  }

  const dependencies = query.dependencies;
  if (dependencies !== undefined) {
    if (dependencies.blocked !== undefined && task.isBlocked !== dependencies.blocked) return false;
    if (dependencies.blocking !== undefined && task.isBlocking !== dependencies.blocking) return false;
    if (dependencies.hasDependencies !== undefined && (task.dependsOn.length > 0) !== dependencies.hasDependencies) return false;
    if (!nonEmptyAny(dependencies.dependsOnAny, (idValue) => task.dependsOn.includes(idValue))) return false;
    if (!nonEmptyAny(dependencies.blockedByAny, (idValue) => task.blockedBy.some(({ id: resolved }) => resolved === idValue))) return false;
    if (!nonEmptyAny(dependencies.blocksAny, (idValue) => task.blocks.some(({ id: resolved }) => resolved === idValue))) return false;
  }
  return true;
}

export function normalizeHeading(value: string): string {
  return value.trim().replace(/:\s*$/, "").toLocaleLowerCase();
}

export function filterTasks(tasks: readonly EnrichedTask[], query: VaultTaskQuery, asOf: string): EnrichedTask[] {
  const { anyOf, sort: _sort, ...root } = query;
  const dates = resolveQueryDateRanges(query, asOf);
  return tasks.filter((task) => matchesFragment(task, root, dates.root) && (anyOf === undefined || anyOf.some((fragment, index) => matchesFragment(task, fragment, dates.anyOf[index] ?? {}))));
}
