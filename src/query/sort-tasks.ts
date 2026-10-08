import { PRIORITY_RANK, TASK_DATE_FIELDS, type SortField, type SortSpec, type TaskDateField } from "../model/index.js";
import type { EnrichedTask } from "./types.js";
const STATUS_RANK = { TODO: 0, IN_PROGRESS: 1, DONE: 2, CANCELLED: 3, UNKNOWN: 4 } as const;

function isTaskDateField(field: SortField): field is TaskDateField {
  return (TASK_DATE_FIELDS as readonly string[]).includes(field);
}

function valueFor(task: EnrichedTask, field: SortField): string | number | null {
  if (isTaskDateField(field)) return task.dates[field];
  switch (field) {
    case "path": return task.path;
    case "line": return task.line;
    case "heading": return task.heading.nearest;
    case "status": return STATUS_RANK[task.status.type];
    case "priority": return PRIORITY_RANK[task.priority];
  }
}

function compareValue(left: string | number | null, right: string | number | null, spec: SortSpec): number {
  if (left === null || right === null) {
    if (left === right) return 0;
    const nullOrder = (spec.missing ?? "last") === "first" ? -1 : 1;
    return left === null ? nullOrder : -nullOrder;
  }
  const base = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right));
  return spec.direction === "asc" ? base : -base;
}

export function sortTasks(tasks: readonly EnrichedTask[], sort: readonly SortSpec[] = []): EnrichedTask[] {
  return tasks.map((task, index) => ({ task, index })).sort((left, right) => {
    for (const spec of sort) {
      const compared = compareValue(valueFor(left.task, spec.field), valueFor(right.task, spec.field), spec);
      if (compared !== 0) return compared;
    }
    const path = left.task.path.localeCompare(right.task.path);
    if (path !== 0) return path;
    const line = left.task.line - right.task.line;
    return line !== 0 ? line : left.index - right.index;
  }).map(({ task }) => task);
}
