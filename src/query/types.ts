import type { VaultTask } from "../model/index.js";

export type ParsedTask = Omit<VaultTask, "blockedBy" | "blocks" | "isBlocked" | "isBlocking">;
export type EnrichedTask = VaultTask;
