import type { CompactTaskResult, DetailedTaskResult, OutputFormat, QueryResult, VaultTaskWarning } from "../model/index.js";
import type { EnrichedTask } from "../query/types.js";

export type ResultEnvelope = QueryResult<CompactTaskResult | DetailedTaskResult>;

function obsidianUri(vaultName: string | undefined, path: string): string | undefined {
  if (vaultName === undefined || vaultName.length === 0) return undefined;
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(path)}`;
}

export function projectTask(task: EnrichedTask, format: OutputFormat, vaultName?: string): CompactTaskResult | DetailedTaskResult {
  const compact: CompactTaskResult = { path: task.path, line: task.line, markdown: task.markdown };
  const uri = obsidianUri(vaultName, task.path);
  if (uri !== undefined) compact.obsidianUri = uri;
  if (task.taskId !== null) compact.taskId = task.taskId;
  if (format === "compact") return compact;
  return {
    ...compact,
    description: task.description,
    status: task.status,
    dates: task.dates,
    priority: task.priority,
    tags: [...task.tags],
    heading: { nearest: task.heading.nearest, hierarchy: [...task.heading.hierarchy] },
    recurrence: task.recurrence,
    dependsOn: [...task.dependsOn],
    blockedBy: [...task.blockedBy],
    blocks: [...task.blocks],
    isBlocked: task.isBlocked,
    isBlocking: task.isBlocking,
  };
}

export interface ProjectionOptions {
  format: OutputFormat; asOf: string; timezone: string; filesScanned: number; tasksScanned: number;
  maxReturnedTasks: number; maxOutputBytes: number; vaultName?: string; warnings?: readonly VaultTaskWarning[];
}

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

export function projectResult(tasks: readonly EnrichedTask[], options: ProjectionOptions): ResultEnvelope {
  const initialWarnings = [...(options.warnings ?? [])];
  const selected: Array<CompactTaskResult | DetailedTaskResult> = [];
  const selectedWarnings: VaultTaskWarning[] = [];
  const candidates = tasks.slice(0, options.maxReturnedTasks);

  const truncationWarning = (omittedTasks: number, omittedWarnings: number): VaultTaskWarning => ({
    code: "OUTPUT_TRUNCATED",
    message: "Some matching tasks or warnings were omitted; narrow the query",
    details: {
      maxReturnedTasks: options.maxReturnedTasks,
      maxOutputBytes: options.maxOutputBytes,
      omittedTasks,
      omittedWarnings,
    },
  });
  const makeEnvelope = (warnings: VaultTaskWarning[]): ResultEnvelope => {
    const omittedTasks = tasks.length - selected.length;
    const omittedWarnings = initialWarnings.length - selectedWarnings.length;
    return {
    format: options.format,
    asOf: options.asOf,
    timezone: options.timezone,
    stats: { filesScanned: options.filesScanned, tasksScanned: options.tasksScanned, totalMatches: tasks.length, returned: selected.length, truncated: omittedTasks > 0 || omittedWarnings > 0 },
    warnings,
    tasks: selected,
    };
  };
  const warningsFor = (omittedTasks: number, omittedWarnings: number): VaultTaskWarning[] => omittedTasks > 0 || omittedWarnings > 0
    ? [...selectedWarnings, truncationWarning(omittedTasks, omittedWarnings)]
    : [...selectedWarnings];

  // Warnings are retained before task records, but a small structured summary is
  // always reserved when either warnings or tasks must be omitted.
  for (const warning of initialWarnings) {
    selectedWarnings.push(warning);
    const omittedWarnings = initialWarnings.length - selectedWarnings.length;
    const candidateWarnings = warningsFor(tasks.length, omittedWarnings);
    if (bytes(makeEnvelope(candidateWarnings)) > options.maxOutputBytes) {
      selectedWarnings.pop();
      break;
    }
  }

  for (const task of candidates) {
    selected.push(projectTask(task, options.format, options.vaultName));
    const omittedTasks = tasks.length - selected.length;
    const omittedWarnings = initialWarnings.length - selectedWarnings.length;
    if (bytes(makeEnvelope(warningsFor(omittedTasks, omittedWarnings))) > options.maxOutputBytes) {
      selected.pop();
      break;
    }
  }
  const omittedTasks = tasks.length - selected.length;
  const omittedWarnings = initialWarnings.length - selectedWarnings.length;
  return makeEnvelope(warningsFor(omittedTasks, omittedWarnings));
}
