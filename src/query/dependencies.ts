import type { TaskReference, VaultTaskWarning } from "../model/index.js";
import type { EnrichedTask, ParsedTask } from "./types.js";

export interface DependencyResolution { tasks: EnrichedTask[]; warnings: VaultTaskWarning[] }

const active = (task: ParsedTask): boolean => task.status.type !== "DONE" && task.status.type !== "CANCELLED";
const ref = (id: string, task: ParsedTask): TaskReference => ({ id, path: task.path, line: task.line });

export function resolveDependencies(tasks: readonly ParsedTask[]): DependencyResolution {
  const index = new Map<string, ParsedTask[]>();
  for (const task of tasks) {
    if (task.taskId === null) continue;
    const entries = index.get(task.taskId) ?? [];
    entries.push(task);
    index.set(task.taskId, entries);
  }

  const warnings: VaultTaskWarning[] = [];
  for (const [id, matches] of index) {
    if (matches.length > 1) warnings.push({ code: "DUPLICATE_TASK_ID", message: `Task ID ${id} is not unique`, details: { id, count: matches.length } });
  }

  const blockedBy = new Map<ParsedTask, TaskReference[]>();
  const blocks = new Map<ParsedTask, TaskReference[]>();
  const blocking = new Set<ParsedTask>();
  const missing = new Set<string>();
  const selfDependencies = new Set<string>();
  for (const dependent of tasks) {
    for (const id of dependent.dependsOn) {
      const matches = index.get(id);
      if (!matches || matches.length === 0) {
        if (!missing.has(id)) {
          missing.add(id);
          warnings.push({ code: "UNRESOLVED_DEPENDENCY", message: `Dependency ID ${id} was not found`, details: { id } });
        }
        continue;
      }
      if (matches.length !== 1) continue;
      const predecessor = matches[0]!;
      if (predecessor === dependent) {
        const key = `${dependent.path}:${dependent.line}:${id}`;
        if (!selfDependencies.has(key)) {
          selfDependencies.add(key);
          warnings.push({ code: "SELF_DEPENDENCY", message: `Task ${id} depends on itself`, path: dependent.path, line: dependent.line, details: { id } });
        }
        continue;
      }
      if (!active(predecessor) || !active(dependent)) continue;
      blockedBy.set(dependent, [...(blockedBy.get(dependent) ?? []), ref(id, predecessor)]);
      blocking.add(predecessor);
      const dependentId = dependent.taskId;
      if (dependentId !== null) blocks.set(predecessor, [...(blocks.get(predecessor) ?? []), ref(dependentId, dependent)]);
    }
  }

  return {
    tasks: tasks.map((task) => {
      const predecessors = blockedBy.get(task) ?? [];
      const successors = blocks.get(task) ?? [];
      return { ...task, blockedBy: predecessors, blocks: successors, isBlocked: predecessors.length > 0, isBlocking: blocking.has(task) };
    }),
    warnings,
  };
}
