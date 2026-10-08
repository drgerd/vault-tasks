export const STATUS_TYPES = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED", "UNKNOWN"] as const;
export type TaskStatusType = (typeof STATUS_TYPES)[number];
export type ConfiguredStatusType = Exclude<TaskStatusType, "UNKNOWN">;

export const PRIORITIES = ["highest", "high", "medium", "none", "low", "lowest"] as const;
export type TaskPriority = (typeof PRIORITIES)[number];

/** Canonical task-date vocabulary shared by parsing, queries, and output. */
export const TASK_DATE_FIELDS = Object.freeze([
  "scheduled", "due", "created", "start", "done", "cancelled",
] as const);
export type TaskDateField = (typeof TASK_DATE_FIELDS)[number];

/** Ordered from least to most important for range filtering and sorting. */
export const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = Object.freeze({
  lowest: 0,
  low: 1,
  none: 2,
  medium: 3,
  high: 4,
  highest: 5,
});

export interface TaskStatus {
  symbol: string;
  name: string;
  type: TaskStatusType;
}

export type TaskDates = Readonly<Record<TaskDateField, string | null>>;

export interface TaskHeading {
  nearest: string | null;
  hierarchy: readonly string[];
}

export interface TaskRecurrence {
  isRecurring: boolean;
  rule: string | null;
}

export interface TaskReference {
  id: string;
  path?: string;
  line?: number;
}

/** Complete internal representation of one parsed task line. */
export interface VaultTask {
  path: string;
  line: number;
  markdown: string;
  description: string;
  status: TaskStatus;
  dates: TaskDates;
  priority: TaskPriority;
  tags: readonly string[];
  heading: TaskHeading;
  recurrence: TaskRecurrence;
  taskId: string | null;
  dependsOn: readonly string[];
  blockedBy: readonly TaskReference[];
  blocks: readonly TaskReference[];
  isBlocked: boolean;
  isBlocking: boolean;
}
