export type WarningCode =
  | "FILE_SKIPPED"
  | "UNKNOWN_STATUS"
  | "UNRESOLVED_DEPENDENCY"
  | "DUPLICATE_TASK_ID"
  | "SELF_DEPENDENCY"
  | "OUTPUT_TRUNCATED";

export interface VaultTaskWarning {
  code: WarningCode;
  message: string;
  path?: string;
  line?: number;
  details?: Readonly<Record<string, string | number | boolean | null>>;
}
