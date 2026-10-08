import type { OutputFormat } from "../model/index.js";

export type CliCommand =
  | { name: "query"; json: string; format?: OutputFormat; asOf?: string }
  | { name: "explain"; json: string; asOf?: string }
  | { name: "archive-done"; dryRun: boolean; asOf?: string }
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
    for (let index = 0; index < rest.length; index += 1) {
      const flag = rest[index];
      if (flag === "--dry-run") {
        if (dryRun) throw new CliArgumentError("--dry-run may be specified only once");
        dryRun = true;
        continue;
      }
      if (flag !== "--as-of") throw new CliArgumentError(`unknown option: ${flag ?? ""}`);
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new CliArgumentError("--as-of requires a value");
      if (asOf !== undefined) throw new CliArgumentError("--as-of may be specified only once");
      asOf = validateIsoDate(value, "--as-of");
      index += 1;
    }
    return { name: "archive-done", dryRun, ...(asOf === undefined ? {} : { asOf }) };
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
  vault-tasks archive-done [--dry-run] [--as-of YYYY-MM-DD]

Configuration is loaded from VAULT_TASKS_CONFIG or /etc/vault-tasks/config.json.
The vault root cannot be supplied in query JSON or CLI arguments.
archive-done applies eligible moves by default. Use --dry-run to print a plan without writing.`;
