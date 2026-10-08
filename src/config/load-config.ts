import { readFileSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";
import type { ConfiguredStatusType, OutputFormat } from "../model/index.js";

export const DEFAULT_CONFIG_PATH = "/etc/vault-tasks/config.json";

export interface StatusConfig {
  symbol: string;
  name: string;
  type: ConfiguredStatusType;
}

export interface ScanConfig {
  excludedDirectories: readonly string[];
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface LimitsConfig {
  maxReturnedTasks: number;
  maxOutputBytes: number;
  maxAnyOfClauses: number;
  maxSortFields: number;
}

export interface OutputConfig { defaultFormat: OutputFormat }

/** Write mode remains disabled until this explicitly configured section exists. */
export interface ArchiveConfig {
  archiveRoot: string;
  sourceRoots: readonly string[];
  minAgeDays: number;
  deleteEmptySourceNotes: boolean;
}

export interface VaultTasksConfig {
  vaultRoot: string;
  timezone: string;
  vaultName?: string;
  statuses: readonly StatusConfig[];
  scan: ScanConfig;
  limits: LimitsConfig;
  output: OutputConfig;
  archive?: ArchiveConfig;
}

export class ConfigValidationError extends Error {
  readonly path: string;
  constructor(path: string, message: string, options?: ErrorOptions) {
    super(`${path}: ${message}`, options);
    this.name = "ConfigValidationError";
    this.path = path;
  }
}

const DEFAULT_STATUSES: readonly StatusConfig[] = Object.freeze([
  Object.freeze({ symbol: " ", name: "Todo", type: "TODO" }),
  Object.freeze({ symbol: "/", name: "In Progress", type: "IN_PROGRESS" }),
  Object.freeze({ symbol: "x", name: "Done", type: "DONE" }),
  Object.freeze({ symbol: "-", name: "Cancelled", type: "CANCELLED" }),
]);

type Obj = Record<string, unknown>;
function object(value: unknown, path: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ConfigValidationError(path, "must be an object");
  return value as Obj;
}
function known(obj: Obj, keys: readonly string[], path: string): void {
  for (const key of Object.keys(obj)) if (!keys.includes(key)) throw new ConfigValidationError(`${path}.${key}`, "unknown field");
}
function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new ConfigValidationError(path, "must be a non-empty string");
  if (value.includes("\0")) throw new ConfigValidationError(path, "must not contain NUL");
  return value.trim();
}
function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new ConfigValidationError(path, `must be an integer from ${min} through ${max}`);
  return value as number;
}
function nested(obj: Obj, key: string, path: string): Obj {
  return key in obj ? object(obj[key], `${path}.${key}`) : {};
}
function timezone(value: unknown, path: string): string {
  const zone = requiredString(value, path);
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); }
  catch (error) { throw new ConfigValidationError(path, "must be a supported IANA timezone", { cause: error }); }
  return zone;
}
function excludedPath(value: unknown, path: string): string {
  const item = requiredString(value, path).replaceAll("\\", "/");
  if (isAbsolute(item) || /^[A-Za-z]:/.test(item)) throw new ConfigValidationError(path, "must be vault-relative");
  if (item.split("/").some((part) => part === "" || part === "." || part === "..")) throw new ConfigValidationError(path, "must not contain empty, dot, or parent segments");
  return item;
}
function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Validate an already parsed configuration object and apply all defaults. */
export function parseConfig(input: unknown): VaultTasksConfig {
  const root = object(input, "$config");
  known(root, ["$schema", "vaultRoot", "timezone", "vaultName", "statuses", "scan", "limits", "output", "archive"], "$config");
  if ("$schema" in root) requiredString(root.$schema, "$config.$schema");
  if (!("vaultRoot" in root)) throw new ConfigValidationError("$config.vaultRoot", "is required");
  const vaultRootInput = requiredString(root.vaultRoot, "$config.vaultRoot");
  if (!isAbsolute(vaultRootInput)) throw new ConfigValidationError("$config.vaultRoot", "must be an absolute path");
  const vaultRoot = normalize(vaultRootInput);

  let statuses: readonly StatusConfig[] = DEFAULT_STATUSES;
  if ("statuses" in root) {
    if (!Array.isArray(root.statuses) || root.statuses.length < 1 || root.statuses.length > 32) throw new ConfigValidationError("$config.statuses", "must contain 1 through 32 statuses");
    const seen = new Set<string>();
    statuses = root.statuses.map((raw, index) => {
      const path = `$config.statuses[${index}]`; const status = object(raw, path);
      known(status, ["symbol", "name", "type"], path);
      for (const key of ["symbol", "name", "type"]) if (!(key in status)) throw new ConfigValidationError(`${path}.${key}`, "is required");
      if (typeof status.symbol !== "string" || [...status.symbol].length !== 1) throw new ConfigValidationError(`${path}.symbol`, "must be exactly one Unicode character");
      if (seen.has(status.symbol)) throw new ConfigValidationError(`${path}.symbol`, "must be unique");
      seen.add(status.symbol);
      const name = requiredString(status.name, `${path}.name`);
      if (name.length > 100) throw new ConfigValidationError(`${path}.name`, "must be at most 100 characters");
      const allowed = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
      if (typeof status.type !== "string" || !allowed.includes(status.type as typeof allowed[number])) throw new ConfigValidationError(`${path}.type`, `must be one of: ${allowed.join(", ")}`);
      return { symbol: status.symbol, name, type: status.type as ConfiguredStatusType };
    });
  }

  const scan = nested(root, "scan", "$config");
  known(scan, ["excludedDirectories", "maxFiles", "maxFileBytes", "maxTotalBytes"], "$config.scan");
  let excludedDirectories = [".obsidian", ".trash"];
  if ("excludedDirectories" in scan) {
    if (!Array.isArray(scan.excludedDirectories)) throw new ConfigValidationError("$config.scan.excludedDirectories", "must be an array");
    excludedDirectories = scan.excludedDirectories.map((value, index) => excludedPath(value, `$config.scan.excludedDirectories[${index}]`));
    if (new Set(excludedDirectories).size !== excludedDirectories.length) throw new ConfigValidationError("$config.scan.excludedDirectories", "must not contain duplicates");
  }

  const limits = nested(root, "limits", "$config");
  known(limits, ["maxReturnedTasks", "maxOutputBytes", "maxAnyOfClauses", "maxSortFields"], "$config.limits");
  const output = nested(root, "output", "$config");
  known(output, ["defaultFormat"], "$config.output");
  const format = output.defaultFormat ?? "compact";
  if (format !== "compact" && format !== "detailed") throw new ConfigValidationError("$config.output.defaultFormat", "must be compact or detailed");

  let archive: ArchiveConfig | undefined;
  if ("archive" in root) {
    const value = object(root.archive, "$config.archive");
    known(value, ["archiveRoot", "sourceRoots", "minAgeDays", "deleteEmptySourceNotes"], "$config.archive");
    if (!("archiveRoot" in value)) throw new ConfigValidationError("$config.archive.archiveRoot", "is required");
    if (!("sourceRoots" in value)) throw new ConfigValidationError("$config.archive.sourceRoots", "is required");
    const archiveRoot = excludedPath(value.archiveRoot, "$config.archive.archiveRoot");
    if (!Array.isArray(value.sourceRoots) || value.sourceRoots.length === 0) throw new ConfigValidationError("$config.archive.sourceRoots", "must contain at least one path");
    const sourceRoots = value.sourceRoots.map((item, index) => excludedPath(item, `$config.archive.sourceRoots[${index}]`));
    if (new Set(sourceRoots).size !== sourceRoots.length) throw new ConfigValidationError("$config.archive.sourceRoots", "must not contain duplicates");
    for (const sourceRoot of sourceRoots) {
      if (overlapsPath(archiveRoot, sourceRoot)) {
        throw new ConfigValidationError("$config.archive", "archiveRoot and sourceRoots must not overlap");
      }
    }
    for (let index = 0; index < sourceRoots.length; index += 1) {
      for (let other = index + 1; other < sourceRoots.length; other += 1) {
        if (overlapsPath(sourceRoots[index] ?? "", sourceRoots[other] ?? "")) {
          throw new ConfigValidationError("$config.archive.sourceRoots", "sourceRoots must not overlap");
        }
      }
    }
    if ("deleteEmptySourceNotes" in value && typeof value.deleteEmptySourceNotes !== "boolean") {
      throw new ConfigValidationError("$config.archive.deleteEmptySourceNotes", "must be boolean");
    }
    archive = {
      archiveRoot,
      sourceRoots,
      minAgeDays: "minAgeDays" in value ? integer(value.minAgeDays, "$config.archive.minAgeDays", 0, 36_500) : 30,
      deleteEmptySourceNotes: value.deleteEmptySourceNotes !== false,
    };
  }

  const result: VaultTasksConfig = {
    vaultRoot,
    timezone: "timezone" in root ? timezone(root.timezone, "$config.timezone") : "Europe/Warsaw",
    ...(root.vaultName === undefined ? {} : { vaultName: requiredString(root.vaultName, "$config.vaultName") }),
    statuses,
    scan: {
      excludedDirectories,
      maxFiles: "maxFiles" in scan ? integer(scan.maxFiles, "$config.scan.maxFiles", 1, 1_000_000) : 10_000,
      maxFileBytes: "maxFileBytes" in scan ? integer(scan.maxFileBytes, "$config.scan.maxFileBytes", 1_024, 1_073_741_824) : 1_048_576,
      maxTotalBytes: "maxTotalBytes" in scan ? integer(scan.maxTotalBytes, "$config.scan.maxTotalBytes", 1_024, 10_737_418_240) : 52_428_800,
    },
    limits: {
      maxReturnedTasks: "maxReturnedTasks" in limits ? integer(limits.maxReturnedTasks, "$config.limits.maxReturnedTasks", 1, 100_000) : 5_000,
      maxOutputBytes: "maxOutputBytes" in limits ? integer(limits.maxOutputBytes, "$config.limits.maxOutputBytes", 16_384, 104_857_600) : 2_097_152,
      maxAnyOfClauses: "maxAnyOfClauses" in limits ? integer(limits.maxAnyOfClauses, "$config.limits.maxAnyOfClauses", 1, 100) : 20,
      maxSortFields: "maxSortFields" in limits ? integer(limits.maxSortFields, "$config.limits.maxSortFields", 1, 20) : 5,
    },
    output: { defaultFormat: format },
    ...(archive === undefined ? {} : { archive }),
  };
  return deepFreeze(result) as VaultTasksConfig;
}

function overlapsPath(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function resolveConfigPath(explicitPath?: string, environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const selected = explicitPath ?? environment.VAULT_TASKS_CONFIG ?? DEFAULT_CONFIG_PATH;
  return resolve(selected);
}

/** Load JSON from the explicit path, VAULT_TASKS_CONFIG, or the system default. */
export function loadConfig(explicitPath?: string, environment: Readonly<Record<string, string | undefined>> = process.env): VaultTasksConfig {
  const path = resolveConfigPath(explicitPath, environment);
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch (error) { throw new ConfigValidationError("$config", `cannot read configuration at ${path}`, { cause: error }); }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch (error) { throw new ConfigValidationError("$config", "must contain valid JSON", { cause: error }); }
  return parseConfig(parsed);
}
