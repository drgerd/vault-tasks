import type { OutputFormat } from "../model/index.js";

export type CliCommand =
  | { name: "query"; json: string; format?: OutputFormat; asOf?: string }
  | { name: "explain"; json: string; asOf?: string }
  | {
    name: "archive-done";
    dryRun: boolean;
    asOf?: string;
    vaultRoot?: string;
    archiveRoot?: string;
    sourceRoots: readonly string[];
    minAgeDays?: number;
    timezone?: string;
    deleteEmptySourceNotes?: boolean;
  }
  | { name: "schema" }
  | { name: "help" };

export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgumentError";
  }
}

export function parseArguments(argv: readonly string[]): CliCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    if (rest.length > 0) throw new CliArgumentError("help does not accept arguments");
    return { name: "help" };
  }
  if (command === "schema") {
    if (rest.length > 0) throw new CliArgumentError("schema does not accept arguments");
    return { name: "schema" };
  }
  if (command === "archive-done") {
    let dryRun = false;
    let asOf: string | undefined;
    let vaultRoot: string | undefined;
    let archiveRoot: string | undefined;
    const sourceRoots: string[] = [];
    let minAgeDays: number | undefined;
    let timezone: string | undefined;
    let deleteEmptySourceNotes: boolean | undefined;
    for (let index = 0; index < rest.length; index += 1) {
      const flag = rest[index];
      if (flag === "--dry-run") {
        if (dryRun) throw new CliArgumentError("--dry-run may be specified only once");
        dryRun = true;
        continue;
      }
      if (flag === "--keep-source-notes") {
        if (deleteEmptySourceNotes !== undefined) throw new CliArgumentError("--keep-source-notes may be specified only once");
        deleteEmptySourceNotes = false;
        continue;
      }
      if (!["--as-of", "--vault-root", "--archive-root", "--source-root", "--min-age-days", "--timezone"].includes(flag ?? "")) {
        throw new CliArgumentError(`unknown option: ${flag ?? ""}`);
      }
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new CliArgumentError(`${flag} requires a value`);
      if (flag === "--as-of") {
        if (asOf !== undefined) throw new CliArgumentError("--as-of may be specified only once");
        asOf = validateIsoDate(value, "--as-of");
      } else if (flag === "--vault-root") {
        if (vaultRoot !== undefined) throw new CliArgumentError("--vault-root may be specified only once");
        vaultRoot = value;
      } else if (flag === "--archive-root") {
        if (archiveRoot !== undefined) throw new CliArgumentError("--archive-root may be specified only once");
        archiveRoot = value;
      } else if (flag === "--source-root") {
        sourceRoots.push(value);
      } else if (flag === "--min-age-days") {
        if (minAgeDays !== undefined) throw new CliArgumentError("--min-age-days may be specified only once");
        if (!/^\d+$/u.test(value)) throw new CliArgumentError("--min-age-days must be a non-negative integer");
        minAgeDays = Number(value);
      } else {
        if (timezone !== undefined) throw new CliArgumentError("--timezone may be specified only once");
        timezone = value;
      }
      index += 1;
    }
    if (vaultRoot === undefined && (archiveRoot !== undefined || sourceRoots.length > 0 || minAgeDays !== undefined || timezone !== undefined || deleteEmptySourceNotes !== undefined)) {
      throw new CliArgumentError("archive options require --vault-root; otherwise use configuration");
    }
    return {
      name: "archive-done", dryRun, sourceRoots,
      ...(asOf === undefined ? {} : { asOf }),
      ...(vaultRoot === undefined ? {} : { vaultRoot }),
      ...(archiveRoot === undefined ? {} : { archiveRoot }),
      ...(minAgeDays === undefined ? {} : { minAgeDays }),
      ...(timezone === undefined ? {} : { timezone }),
      ...(deleteEmptySourceNotes === undefined ? {} : { deleteEmptySourceNotes }),
    };
  }
  if (command !== "query" && command !== "explain") {
    throw new CliArgumentError(`unknown command: ${command}`);
  }

  let json: string | undefined;
  let format: OutputFormat | undefined;
  let asOf: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag !== "--json" && flag !== "--format" && flag !== "--as-of") {
      throw new CliArgumentError(`unknown option: ${flag ?? ""}`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliArgumentError(`${flag} requires a value`);
    }
    index += 1;
    if (flag === "--json") {
      if (json !== undefined) throw new CliArgumentError("--json may be specified only once");
      json = value;
    } else if (flag === "--format") {
      if (command !== "query") throw new CliArgumentError("--format is supported only by query");
      if (format !== undefined) throw new CliArgumentError("--format may be specified only once");
      if (value !== "compact" && value !== "detailed") throw new CliArgumentError("--format must be compact or detailed");
      format = value;
    } else {
      if (asOf !== undefined) throw new CliArgumentError("--as-of may be specified only once");
      asOf = validateIsoDate(value, "--as-of");
    }
  }
  if (json === undefined) throw new CliArgumentError(`${command} requires --json`);
  return command === "query"
    ? { name: "query", json, ...(format === undefined ? {} : { format }), ...(asOf === undefined ? {} : { asOf }) }
    : { name: "explain", json, ...(asOf === undefined ? {} : { asOf }) };
}

export function validateIsoDate(value: string, label = "date"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new CliArgumentError(`${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new CliArgumentError(`${label} must be a valid calendar date`);
  }
  return value;
}

export const HELP_TEXT = `vault-tasks — structured Obsidian task queries

Usage:
  vault-tasks query --json '<QUERY_JSON>' [--format compact|detailed] [--as-of YYYY-MM-DD]
  vault-tasks explain --json '<QUERY_JSON>' [--as-of YYYY-MM-DD]
  vault-tasks schema
  vault-tasks archive-done [--vault-root PATH] [--archive-root PATH] [--source-root PATH]... [--min-age-days DAYS] [--timezone IANA_ZONE] [--keep-source-notes] [--dry-run] [--as-of YYYY-MM-DD]

Configuration is loaded from VAULT_TASKS_CONFIG or /etc/vault-tasks/config.json.
For archive-done, --vault-root creates a self-contained configuration: it scans the whole vault,
archives under Archive, waits 30 days, and deletes empty source notes. Use --source-root to limit scope.
archive-done applies eligible moves by default. Use --dry-run to print a plan without writing.`;
