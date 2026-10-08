import {
  PRIORITIES,
  STATUS_TYPES,
  TASK_DATE_FIELDS,
  type ConfiguredStatusType,
  type TaskDateField,
  type TaskPriority,
} from "./task.js";

export type DateExpression = string;

export interface DateFilter {
  from?: DateExpression;
  to?: DateExpression;
  fromInclusive?: boolean;
  toInclusive?: boolean;
  missing?: boolean;
}

export interface HeadingFilter { anyOf?: readonly string[]; containsAny?: readonly string[]; missing?: boolean }
export interface StatusFilter { anyOf?: readonly ConfiguredStatusType[]; symbols?: readonly string[] }
export interface TagsFilter { anyOf?: readonly string[]; allOf?: readonly string[]; noneOf?: readonly string[]; missing?: boolean }
export interface PriorityFilter { anyOf?: readonly TaskPriority[]; atLeast?: TaskPriority; atMost?: TaskPriority }
export interface RecurrenceFilter { state?: "any" | "only" | "exclude"; contains?: string }
export interface SourceFilter { pathsAny?: readonly string[]; pathPrefixesAny?: readonly string[]; fileNamesAny?: readonly string[] }
export interface IdFilter { anyOf?: readonly string[]; present?: boolean }
export interface DependenciesFilter {
  blocked?: boolean;
  blocking?: boolean;
  hasDependencies?: boolean;
  dependsOnAny?: readonly string[];
  blockedByAny?: readonly string[];
  blocksAny?: readonly string[];
}

export const SORT_FIELDS = ["path", "line", "heading", "status", "priority", ...TASK_DATE_FIELDS] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export interface SortSpec { field: SortField; direction: "asc" | "desc"; missing?: "first" | "last" }

export interface QueryFragment extends Partial<Record<TaskDateField, DateFilter>> {
  heading?: HeadingFilter;
  status?: StatusFilter;
  tags?: TagsFilter;
  priority?: PriorityFilter;
  recurrence?: RecurrenceFilter;
  source?: SourceFilter;
  id?: IdFilter;
  dependencies?: DependenciesFilter;
}

export interface VaultTaskQuery extends QueryFragment {
  anyOf?: readonly QueryFragment[];
  sort?: readonly SortSpec[];
}

export interface QueryValidationLimits {
  maxAnyOfClauses: number;
  maxSortFields: number;
}

export class QueryValidationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "QueryValidationError";
    this.path = path;
  }
}

const fragmentKeys = ["heading", "status", "tags", ...TASK_DATE_FIELDS, "priority", "recurrence", "source", "id", "dependencies"] as const;
const topKeys = [...fragmentKeys, "anyOf", "sort"] as const;
const dateExpression = /^(?:\d{4}-\d{2}-\d{2}|today|yesterday|tomorrow|[+-]\d+d)$/;

type JsonObject = Record<string, unknown>;

function object(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new QueryValidationError(path, "must be an object");
  return value as JsonObject;
}

function known(obj: JsonObject, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) throw new QueryValidationError(`${path}.${key}`, "unknown field");
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new QueryValidationError(path, "must be a boolean");
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new QueryValidationError(path, "must be a non-empty string");
  return value.trim();
}

function stringArray(value: unknown, path: string, map: (v: string, path: string) => string = stringValue): string[] {
  if (!Array.isArray(value)) throw new QueryValidationError(path, "must be an array");
  return value.map((item, index) => map(item as string, `${path}[${index}]`));
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new QueryValidationError(path, `must be one of: ${allowed.join(", ")}`);
  return value as T;
}

function optional<T>(obj: JsonObject, key: string, read: (value: unknown, path: string) => T, path: string): T | undefined {
  return key in obj ? read(obj[key], `${path}.${key}`) : undefined;
}

function compact<T extends JsonObject>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}

function unique(values: string[], path: string): string[] {
  if (new Set(values).size !== values.length) throw new QueryValidationError(path, "must not contain duplicates");
  return values;
}

function readDate(value: unknown, path: string): DateFilter {
  const obj = object(value, path);
  known(obj, ["from", "to", "fromInclusive", "toInclusive", "missing"], path);
  const readExpr = (v: unknown, p: string): string => {
    const expr = stringValue(v, p);
    if (!dateExpression.test(expr) || (expr[4] === "-" && Number.isNaN(Date.parse(`${expr}T00:00:00Z`)))) throw new QueryValidationError(p, "must be an ISO date or today/yesterday/tomorrow/signed day offset");
    if (/^\d{4}-/.test(expr)) {
      const parsed = new Date(`${expr}T00:00:00Z`);
      if (parsed.toISOString().slice(0, 10) !== expr) throw new QueryValidationError(p, "must be a valid ISO calendar date");
    }
    return expr;
  };
  const from = optional(obj, "from", readExpr, path);
  const to = optional(obj, "to", readExpr, path);
  const missing = optional(obj, "missing", booleanValue, path);
  if (missing === true && (from !== undefined || to !== undefined)) throw new QueryValidationError(path, "missing:true cannot be combined with bounds");
  if (from === undefined && "fromInclusive" in obj) throw new QueryValidationError(`${path}.fromInclusive`, "requires from");
  if (to === undefined && "toInclusive" in obj) throw new QueryValidationError(`${path}.toInclusive`, "requires to");
  return compact({
    from, to,
    fromInclusive: optional(obj, "fromInclusive", booleanValue, path) ?? (from === undefined ? undefined : true),
    toInclusive: optional(obj, "toInclusive", booleanValue, path) ?? (to === undefined ? undefined : true),
    missing,
  }) as DateFilter;
}

function readRelativePath(value: unknown, path: string): string {
  const raw = stringValue(value, path).replaceAll("\\", "/");
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw) || raw.includes("\0")) throw new QueryValidationError(path, "must be a vault-relative POSIX path");
  const segments = raw.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw new QueryValidationError(path, "must not contain empty, dot, or parent segments");
  return raw;
}

function readRelativePathPrefix(value: unknown, path: string): string {
  const raw = stringValue(value, path).replaceAll("\\", "/");
  const normalized = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return readRelativePath(normalized, path);
}

function readFragment(input: unknown, path: string): QueryFragment {
  const obj = object(input, path);
  known(obj, fragmentKeys, path);
  const out: Record<string, unknown> = {};
  for (const field of TASK_DATE_FIELDS) if (field in obj) out[field] = readDate(obj[field], `${path}.${field}`);
  if ("heading" in obj) {
    const v = object(obj.heading, `${path}.heading`); known(v, ["anyOf", "containsAny", "missing"], `${path}.heading`);
    const normalizeHeading = (x: string, p: string): string => {
      const normalized = stringValue(x, p).replace(/:\s*$/, "").trim();
      if (normalized === "") throw new QueryValidationError(p, "must contain heading text");
      return normalized;
    };
    out.heading = compact({ anyOf: optional(v, "anyOf", (x, p) => unique(stringArray(x, p, normalizeHeading), p), `${path}.heading`), containsAny: optional(v, "containsAny", (x, p) => unique(stringArray(x, p), p), `${path}.heading`), missing: optional(v, "missing", booleanValue, `${path}.heading`) });
  }
  if ("status" in obj) {
    const v = object(obj.status, `${path}.status`); known(v, ["anyOf", "symbols"], `${path}.status`);
    out.status = compact({ anyOf: optional(v, "anyOf", (x, p) => { if (!Array.isArray(x)) throw new QueryValidationError(p, "must be an array"); return x.map((y, i) => enumValue(y, STATUS_TYPES.slice(0, 4), `${p}[${i}]`)); }, `${path}.status`), symbols: optional(v, "symbols", (x, p) => unique(stringArray(x, p, (y, q) => { if (typeof y !== "string" || [...y].length !== 1) throw new QueryValidationError(q, "must be one character"); return y; }), p), `${path}.status`) });
  }
  if ("tags" in obj) {
    const v = object(obj.tags, `${path}.tags`); known(v, ["anyOf", "allOf", "noneOf", "missing"], `${path}.tags`);
    const tagList = (x: unknown, p: string) => unique(stringArray(x, p, (y, q) => { const tag = stringValue(y, q); return tag.startsWith("#") ? tag : `#${tag}`; }), p);
    out.tags = compact({ anyOf: optional(v, "anyOf", tagList, `${path}.tags`), allOf: optional(v, "allOf", tagList, `${path}.tags`), noneOf: optional(v, "noneOf", tagList, `${path}.tags`), missing: optional(v, "missing", booleanValue, `${path}.tags`) });
  }
  if ("priority" in obj) {
    const v = object(obj.priority, `${path}.priority`); known(v, ["anyOf", "atLeast", "atMost"], `${path}.priority`);
    out.priority = compact({ anyOf: optional(v, "anyOf", (x, p) => { if (!Array.isArray(x)) throw new QueryValidationError(p, "must be an array"); return x.map((y, i) => enumValue(y, PRIORITIES, `${p}[${i}]`)); }, `${path}.priority`), atLeast: optional(v, "atLeast", (x, p) => enumValue(x, PRIORITIES, p), `${path}.priority`), atMost: optional(v, "atMost", (x, p) => enumValue(x, PRIORITIES, p), `${path}.priority`) });
  }
  if ("recurrence" in obj) {
    const v = object(obj.recurrence, `${path}.recurrence`); known(v, ["state", "contains"], `${path}.recurrence`);
    const state = optional(v, "state", (x, p) => enumValue(x, ["any", "only", "exclude"] as const, p), `${path}.recurrence`);
    const contains = optional(v, "contains", stringValue, `${path}.recurrence`);
    if (state === "exclude" && contains !== undefined) throw new QueryValidationError(`${path}.recurrence`, "contains cannot be combined with state:exclude");
    out.recurrence = compact({ state, contains });
  }
  if ("source" in obj) {
    const v = object(obj.source, `${path}.source`); known(v, ["pathsAny", "pathPrefixesAny", "fileNamesAny"], `${path}.source`);
    const paths = (x: unknown, p: string) => unique(stringArray(x, p, readRelativePath), p);
    out.source = compact({ pathsAny: optional(v, "pathsAny", paths, `${path}.source`), pathPrefixesAny: optional(v, "pathPrefixesAny", (x, p) => unique(stringArray(x, p, readRelativePathPrefix), p), `${path}.source`), fileNamesAny: optional(v, "fileNamesAny", (x, p) => unique(stringArray(x, p, (y, q) => { const s = stringValue(y, q); if (s.includes("/") || s.includes("\\")) throw new QueryValidationError(q, "must be a file name, not a path"); return s; }), p), `${path}.source`) });
  }
  if ("id" in obj) {
    const v = object(obj.id, `${path}.id`); known(v, ["anyOf", "present"], `${path}.id`);
    out.id = compact({ anyOf: optional(v, "anyOf", (x, p) => unique(stringArray(x, p), p), `${path}.id`), present: optional(v, "present", booleanValue, `${path}.id`) });
  }
  if ("dependencies" in obj) {
    const v = object(obj.dependencies, `${path}.dependencies`); known(v, ["blocked", "blocking", "hasDependencies", "dependsOnAny", "blockedByAny", "blocksAny"], `${path}.dependencies`);
    const ids = (x: unknown, p: string) => unique(stringArray(x, p), p);
    out.dependencies = compact({ blocked: optional(v, "blocked", booleanValue, `${path}.dependencies`), blocking: optional(v, "blocking", booleanValue, `${path}.dependencies`), hasDependencies: optional(v, "hasDependencies", booleanValue, `${path}.dependencies`), dependsOnAny: optional(v, "dependsOnAny", ids, `${path}.dependencies`), blockedByAny: optional(v, "blockedByAny", ids, `${path}.dependencies`), blocksAny: optional(v, "blocksAny", ids, `${path}.dependencies`) });
  }
  return out as QueryFragment;
}

export function validateAndNormalizeQuery(input: unknown, limits: QueryValidationLimits): VaultTaskQuery {
  const obj = object(input, "$query");
  known(obj, topKeys, "$query");
  const result = readFragment(Object.fromEntries(Object.entries(obj).filter(([key]) => fragmentKeys.includes(key as typeof fragmentKeys[number]))), "$query") as Record<string, unknown>;
  if ("anyOf" in obj) {
    if (!Array.isArray(obj.anyOf)) throw new QueryValidationError("$query.anyOf", "must be an array");
    if (obj.anyOf.length > limits.maxAnyOfClauses) throw new QueryValidationError("$query.anyOf", `must contain at most ${limits.maxAnyOfClauses} clauses`);
    result.anyOf = obj.anyOf.map((clause, index) => readFragment(clause, `$query.anyOf[${index}]`));
  }
  if ("sort" in obj) {
    if (!Array.isArray(obj.sort)) throw new QueryValidationError("$query.sort", "must be an array");
    if (obj.sort.length > limits.maxSortFields) throw new QueryValidationError("$query.sort", `must contain at most ${limits.maxSortFields} fields`);
    result.sort = obj.sort.map((item, index) => {
      const path = `$query.sort[${index}]`; const v = object(item, path); known(v, ["field", "direction", "missing"], path);
      if (!("field" in v) || !("direction" in v)) throw new QueryValidationError(path, "field and direction are required");
      return compact({ field: enumValue(v.field, SORT_FIELDS, `${path}.field`), direction: enumValue(v.direction, ["asc", "desc"] as const, `${path}.direction`), missing: optional(v, "missing", (x, p) => enumValue(x, ["first", "last"] as const, p), path) });
    });
  }
  return Object.freeze(result) as unknown as VaultTaskQuery;
}

/** Public, path-free query contract printed by the schema command. */
const DATE_FILTER_PROPERTIES = Object.freeze(Object.fromEntries(
  TASK_DATE_FIELDS.map((field) => [field, { $ref: "#/$defs/date" }]),
));

export const QUERY_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "vault-tasks query",
  type: "object",
  additionalProperties: false,
  description: "Optional filter families combine with AND; top-level anyOf provides one bounded, non-recursive OR group.",
  properties: {
    heading: { $ref: "#/$defs/heading" }, status: { $ref: "#/$defs/status" }, tags: { $ref: "#/$defs/tags" },
    ...DATE_FILTER_PROPERTIES,
    priority: { $ref: "#/$defs/priority" }, recurrence: { $ref: "#/$defs/recurrence" }, source: { $ref: "#/$defs/source" },
    id: { $ref: "#/$defs/id" }, dependencies: { $ref: "#/$defs/dependencies" },
    anyOf: { type: "array", description: "Bounded by configured maxAnyOfClauses.", items: { $ref: "#/$defs/fragment" } },
    sort: { type: "array", description: "Bounded by configured maxSortFields.", items: { $ref: "#/$defs/sort" } },
  },
  $defs: {
    strings: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    dateExpression: { type: "string", pattern: "^(?:\\d{4}-\\d{2}-\\d{2}|today|yesterday|tomorrow|[+-]\\d+d)$" },
    date: {
      type: "object", additionalProperties: false,
      properties: { from: { $ref: "#/$defs/dateExpression" }, to: { $ref: "#/$defs/dateExpression" }, fromInclusive: { type: "boolean" }, toInclusive: { type: "boolean" }, missing: { type: "boolean" } },
    },
    heading: { type: "object", additionalProperties: false, properties: { anyOf: { $ref: "#/$defs/strings" }, containsAny: { $ref: "#/$defs/strings" }, missing: { type: "boolean" } } },
    status: { type: "object", additionalProperties: false, properties: { anyOf: { type: "array", items: { enum: STATUS_TYPES.slice(0, 4) } }, symbols: { type: "array", items: { type: "string", minLength: 1, maxLength: 1 }, uniqueItems: true } } },
    tags: { type: "object", additionalProperties: false, properties: { anyOf: { $ref: "#/$defs/strings" }, allOf: { $ref: "#/$defs/strings" }, noneOf: { $ref: "#/$defs/strings" }, missing: { type: "boolean" } } },
    priority: { type: "object", additionalProperties: false, properties: { anyOf: { type: "array", items: { enum: PRIORITIES } }, atLeast: { enum: PRIORITIES }, atMost: { enum: PRIORITIES } } },
    recurrence: { type: "object", additionalProperties: false, properties: { state: { enum: ["any", "only", "exclude"] }, contains: { type: "string", minLength: 1 } } },
    source: { type: "object", additionalProperties: false, properties: { pathsAny: { $ref: "#/$defs/strings" }, pathPrefixesAny: { $ref: "#/$defs/strings" }, fileNamesAny: { $ref: "#/$defs/strings" } } },
    id: { type: "object", additionalProperties: false, properties: { anyOf: { $ref: "#/$defs/strings" }, present: { type: "boolean" } } },
    dependencies: { type: "object", additionalProperties: false, properties: { blocked: { type: "boolean" }, blocking: { type: "boolean" }, hasDependencies: { type: "boolean" }, dependsOnAny: { $ref: "#/$defs/strings" }, blockedByAny: { $ref: "#/$defs/strings" }, blocksAny: { $ref: "#/$defs/strings" } } },
    sort: { type: "object", additionalProperties: false, required: ["field", "direction"], properties: { field: { enum: SORT_FIELDS }, direction: { enum: ["asc", "desc"] }, missing: { enum: ["first", "last"] } } },
    fragment: {
      type: "object", additionalProperties: false,
      properties: {
        heading: { $ref: "#/$defs/heading" }, status: { $ref: "#/$defs/status" }, tags: { $ref: "#/$defs/tags" },
        ...DATE_FILTER_PROPERTIES,
        priority: { $ref: "#/$defs/priority" }, recurrence: { $ref: "#/$defs/recurrence" }, source: { $ref: "#/$defs/source" }, id: { $ref: "#/$defs/id" }, dependencies: { $ref: "#/$defs/dependencies" },
      },
    },
  },
});
