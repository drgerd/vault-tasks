#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { ConfigValidationError, loadConfig, type VaultTasksConfig } from "../config/index.js";
import {
  QUERY_SCHEMA,
  QueryValidationError,
  systemClock,
  validateAndNormalizeQuery,
  type Clock,
  type OutputFormat,
} from "../model/index.js";
import { executeQuery } from "../query/query-service.js";
import { resolveDateRange, resolveQueryDateRanges, type ResolvedDateRange } from "../query/dates.js";
import { TASK_DATE_FIELDS, type QueryFragment, type VaultTaskQuery } from "../model/index.js";
import { VaultScanError, scanVault } from "../vault/scan-vault.js";
import { ArchiveError, archiveDone } from "../archive/service.js";
import { CliArgumentError, HELP_TEXT, parseArguments } from "./arguments.js";

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface CliDependencies {
  loadConfig(): VaultTasksConfig;
  clock: Clock;
  scan: typeof scanVault;
  archive?: typeof archiveDone;
}

const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

const defaultDependencies: CliDependencies = {
  loadConfig: () => loadConfig(),
  clock: systemClock,
  scan: scanVault,
  archive: archiveDone,
};

export async function runCli(
  argv: readonly string[],
  io: CliIo = defaultIo,
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  try {
    const command = parseArguments(argv);
    if (command.name === "help") {
      io.stdout(`${HELP_TEXT}\n`);
      return 0;
    }
    if (command.name === "schema") {
      io.stdout(`${JSON.stringify(publicSchema(), null, 2)}\n`);
      return 0;
    }

    const config = dependencies.loadConfig();
    const asOf = command.asOf ?? currentDateInZone(dependencies.clock.now(), config.timezone);
    if (command.name === "archive-done") {
      if (config.archive === undefined) throw new ArchiveError("ARCHIVE_NOT_CONFIGURED", "Archive mode requires an archive configuration section");
      const archive = await (dependencies.archive ?? archiveDone)({
        vaultRoot: config.vaultRoot, archive: config.archive, statuses: config.statuses, asOf, apply: command.apply,
      });
      io.stdout(`${JSON.stringify(archive)}\n`);
      return archive.partial ? 1 : 0;
    }
    const input = parseQueryJson(command.json);
    const query = validateAndNormalizeQuery(input, config.limits);
    validateResolvedDates(query, asOf);

    if (command.name === "explain") {
      io.stdout(`${JSON.stringify({ query: resolveQueryForExplain(query, asOf), asOf, timezone: config.timezone }, null, 2)}\n`);
      return 0;
    }

    const scan = await dependencies.scan({
      vaultRoot: config.vaultRoot,
      statuses: config.statuses,
      scan: config.archive === undefined || config.scan.excludedDirectories.includes(config.archive.archiveRoot)
        ? config.scan
        : { ...config.scan, excludedDirectories: [...config.scan.excludedDirectories, config.archive.archiveRoot] },
    });
    const format: OutputFormat = command.name === "query" ? command.format ?? config.output.defaultFormat : config.output.defaultFormat;
    const baseOptions = {
      query,
      format,
      asOf,
      timezone: config.timezone,
      maxReturnedTasks: config.limits.maxReturnedTasks,
      maxOutputBytes: config.limits.maxOutputBytes,
    };
    const result = executeQuery(scan, config.vaultName === undefined
      ? baseOptions
      : { ...baseOptions, vaultName: config.vaultName });
    io.stdout(JSON.stringify(result));
    return 0;
  } catch (error) {
    const failure = serializeError(error);
    io.stderr(`${JSON.stringify({ error: failure })}\n`);
    return failure.code === "INTERNAL_ERROR" ? 1 : 2;
  }
}

function validateResolvedDates(query: VaultTaskQuery, asOf: string): void {
  try {
    resolveQueryDateRanges(query, asOf);
  } catch (error) {
    throw new QueryValidationError("$query", error instanceof Error ? error.message : "invalid date range");
  }
}

function resolveQueryForExplain(query: VaultTaskQuery, asOf: string): VaultTaskQuery {
  const resolveFragment = (fragment: QueryFragment): QueryFragment => {
    const result: Record<string, unknown> = { ...fragment };
    for (const field of TASK_DATE_FIELDS) {
      const range = fragment[field];
      if (range === undefined) continue;
      let resolved: ResolvedDateRange;
      try {
        resolved = resolveDateRange(range, asOf);
      } catch (error) {
        throw new QueryValidationError(`$query.${field}`, error instanceof Error ? error.message : "invalid date range");
      }
      result[field] = resolved;
    }
    return result as QueryFragment;
  };
  const { anyOf, sort, ...root } = query;
  return {
    ...resolveFragment(root),
    ...(anyOf === undefined ? {} : { anyOf: anyOf.map(resolveFragment) }),
    ...(sort === undefined ? {} : { sort }),
  };
}

function parseQueryJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new CliArgumentError(`--json must contain valid JSON: ${error instanceof Error ? error.message : "parse failed"}`);
  }
}

export function currentDateInZone(now: Date, timezone: string): string {
  if (Number.isNaN(now.valueOf())) throw new Error("Clock returned an invalid date");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((candidate) => candidate.type === type)?.value;
    if (value === undefined) throw new Error(`Cannot resolve ${type} in timezone ${timezone}`);
    return value;
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function publicSchema(): object {
  return {
    query: QUERY_SCHEMA,
    formats: {
      compact: { requiredTaskFields: ["path", "line", "markdown"], optionalTaskFields: ["obsidianUri", "taskId"] },
      detailed: {
        requiredTaskFields: [
          "path", "line", "markdown", "description", "status", "dates", "priority", "tags",
          "heading", "recurrence", "dependsOn", "blockedBy", "blocks", "isBlocked", "isBlocking",
        ],
      },
    },
    behavior: {
      emptyQueryMatchesAllTasks: true,
      defaultFormat: "compact",
      pagination: false,
      vaultRootAcceptedInQuery: false,
    },
    limits: {
      maxFiles: { configurable: true, default: 10_000, minimum: 1, maximum: 1_000_000, scope: "visited filesystem entries" },
      maxFileBytes: { configurable: true, default: 1_048_576, minimum: 1_024, maximum: 1_073_741_824 },
      maxTotalBytes: { configurable: true, default: 52_428_800, minimum: 1_024, maximum: 10_737_418_240 },
      maxReturnedTasks: { configurable: true, default: 5_000, minimum: 1, maximum: 100_000 },
      maxOutputBytes: { configurable: true, default: 2_097_152, minimum: 16_384, maximum: 104_857_600 },
      maxAnyOfClauses: { configurable: true, default: 20, minimum: 1, maximum: 100 },
      maxSortFields: { configurable: true, default: 5, minimum: 1, maximum: 20 },
    },
  };
}

function serializeError(error: unknown): { code: string; message: string; path?: string } {
  if (error instanceof QueryValidationError) return { code: "QUERY_VALIDATION_ERROR", message: error.message, path: error.path };
  if (error instanceof ConfigValidationError) return { code: "CONFIG_VALIDATION_ERROR", message: error.message, path: error.path };
  if (error instanceof CliArgumentError) return { code: "CLI_ARGUMENT_ERROR", message: error.message };
  if (error instanceof VaultScanError) return { code: error.code, message: error.message };
  if (error instanceof ArchiveError) return { code: error.code, message: error.message };
  return { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Unexpected error" };
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
