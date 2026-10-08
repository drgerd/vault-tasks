import type { TaskDates, TaskHeading, TaskPriority, TaskRecurrence, TaskReference, TaskStatus } from "./task.js";
import type { VaultTaskWarning } from "./warning.js";

export type OutputFormat = "compact" | "detailed";

export interface ResultStats {
  filesScanned: number;
  tasksScanned: number;
  totalMatches: number;
  returned: number;
  truncated: boolean;
}

export interface CompactTaskResult {
  path: string;
  line: number;
  markdown: string;
  obsidianUri?: string;
  taskId?: string;
}

export interface DetailedTaskResult extends CompactTaskResult {
  description: string;
  status: TaskStatus;
  dates: TaskDates;
  priority: TaskPriority;
  tags: readonly string[];
  heading: TaskHeading;
  recurrence: TaskRecurrence;
  dependsOn: readonly string[];
  blockedBy: readonly TaskReference[];
  blocks: readonly TaskReference[];
  isBlocked: boolean;
  isBlocking: boolean;
}

export interface QueryResult<T extends CompactTaskResult = CompactTaskResult> {
  format: OutputFormat;
  asOf: string;
  timezone: string;
  stats: ResultStats;
  warnings: readonly VaultTaskWarning[];
  tasks: readonly T[];
}
