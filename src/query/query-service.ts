import type { OutputFormat, QueryResult, VaultTaskQuery, VaultTaskWarning, WarningCode } from "../model/index.js";
import { projectResult } from "../output/project-result.js";
import { resolveDependencies } from "./dependencies.js";
import { filterTasks } from "./filter-tasks.js";
import { sortTasks } from "./sort-tasks.js";
import type { ParsedTask } from "./types.js";

export interface QueryScanWarning { code: string; message: string; path?: string; line?: number }
export interface QueryScan { tasks: readonly ParsedTask[]; filesScanned: number; warnings?: readonly QueryScanWarning[] }
export interface QueryServiceOptions {
  query: VaultTaskQuery;
  format: OutputFormat;
  asOf: string;
  timezone: string;
  maxReturnedTasks: number;
  maxOutputBytes: number;
  vaultName?: string;
}

export function executeQuery(scan: QueryScan, options: QueryServiceOptions): QueryResult {
  const dependencies = resolveDependencies(scan.tasks);
  const matching = filterTasks(dependencies.tasks, options.query, options.asOf);
  const sorted = sortTasks(matching, options.query.sort);
  const projection = {
    format: options.format,
    asOf: options.asOf,
    timezone: options.timezone,
    filesScanned: scan.filesScanned,
    tasksScanned: scan.tasks.length,
    maxReturnedTasks: options.maxReturnedTasks,
    maxOutputBytes: options.maxOutputBytes,
    warnings: [...(scan.warnings ?? []).map(normalizeScanWarning), ...dependencies.warnings],
  };
  if (options.vaultName !== undefined) return projectResult(sorted, { ...projection, vaultName: options.vaultName });
  return projectResult(sorted, projection);
}

const RESULT_WARNING_CODES: ReadonlySet<string> = new Set<WarningCode>([
  "FILE_SKIPPED", "UNKNOWN_STATUS", "UNRESOLVED_DEPENDENCY", "DUPLICATE_TASK_ID",
  "SELF_DEPENDENCY", "OUTPUT_TRUNCATED",
]);

function normalizeScanWarning(warning: QueryScanWarning): VaultTaskWarning {
  const normalized: VaultTaskWarning = {
    code: RESULT_WARNING_CODES.has(warning.code) ? warning.code as WarningCode : "FILE_SKIPPED",
    message: warning.message,
  };
  if (!RESULT_WARNING_CODES.has(warning.code)) normalized.details = { scanCode: warning.code };
  if (warning.path !== undefined) normalized.path = warning.path;
  if (warning.line !== undefined) normalized.line = warning.line;
  return normalized;
}
