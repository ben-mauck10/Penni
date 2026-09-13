// Presentation Service — derives a child-safe YotoPresentationState from
// internal Penni plan data. Never reads raw TrueLayer responses.

import type { PenniPlan } from "../types";
import type { BalanceMode, YotoPresentationState } from "./types";
import { getConnection, getPresentationStateJson } from "./db";

// ---------------------------------------------------------------------------
// 6.1 — deriveState
// ---------------------------------------------------------------------------

/**
 * Derives a `YotoPresentationState` exclusively from the given `PenniPlan`
 * pot values, save goal progress, and optional pass-through fields.
 *
 * - `availableAmountPence` is omitted when `balanceMode` is `"hidden"`.
 * - `availableAmountPence` is rounded to the nearest 100 pence when `"rounded"`.
 * - `goalProgressPercent` is derived from the first save goal's `allocated` vs
 *   `target`, capped at 100. Omitted if no save goal exists.
 * - `activityPromptId` is always `"default"` when data is available.
 * - `generatedAt` is the current UTC ISO string.
 */
export function deriveState(
  plan: PenniPlan,
  balanceMode: BalanceMode,
  opts?: {
    childDisplayName?: string;
    weeklyChangePence?: number;
  }
): YotoPresentationState {
  // Convert the save-pot amount (in pounds) to pence as an integer.
  const savePotPence = Math.round(plan.pots.save * 100);

  // Derive availableAmountPence according to balanceMode.
  let availableAmountPence: number | undefined;
  if (balanceMode === "exact") {
    availableAmountPence = savePotPence;
  } else if (balanceMode === "rounded") {
    availableAmountPence = Math.round(savePotPence / 100) * 100;
  }
  // "hidden" → leave undefined

  // Derive goal fields from the primary (first) save goal.
  const primaryGoal = plan.saveGoals?.[0];
  let goalName: string | undefined;
  let goalProgressPercent: number | undefined;

  if (primaryGoal) {
    goalName = primaryGoal.name;
    if (
      typeof primaryGoal.allocated === "number" &&
      typeof primaryGoal.target === "number" &&
      primaryGoal.target > 0
    ) {
      const raw = Math.round((primaryGoal.allocated / primaryGoal.target) * 100);
      goalProgressPercent = Math.min(100, raw);
    }
  }

  const state: YotoPresentationState = {
    balanceMode,
    activityPromptId: "default",
    generatedAt: new Date().toISOString(),
  };

  if (opts?.childDisplayName !== undefined) {
    state.childDisplayName = opts.childDisplayName;
  }

  if (availableAmountPence !== undefined) {
    state.availableAmountPence = availableAmountPence;
  }

  if (goalName !== undefined) {
    state.goalName = goalName;
  }

  if (goalProgressPercent !== undefined) {
    state.goalProgressPercent = goalProgressPercent;
  }

  if (opts?.weeklyChangePence !== undefined) {
    state.weeklyChangePence = opts.weeklyChangePence;
  }

  return state;
}

export function deriveFallbackState(balanceMode: BalanceMode): YotoPresentationState {
  return {
    balanceMode,
    activityPromptId: "fallback",
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 6.2 — deriveStateForFamily
// ---------------------------------------------------------------------------

/**
 * Reads the Penni plan from server-side storage and the family's balance mode
 * from the Connection Store, then calls `deriveState`.
 *
 * Returns `null` if no plan is available (e.g. bank not yet linked).
 */
export function deriveStateForFamily(familyId: string): YotoPresentationState | null {
  const balanceMode: BalanceMode =
    getConnection(familyId)?.balanceMode ?? "hidden";

  const serialized = getPresentationStateJson(familyId);
  if (!serialized) {
    return deriveFallbackState(balanceMode);
  }

  const parsed = deserializeState(serialized);
  if ("errorType" in parsed) {
    return null;
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// 6.3 — serializeState / deserializeState
// ---------------------------------------------------------------------------

/**
 * Serialises a `YotoPresentationState` to a JSON string.
 */
export function serializeState(state: YotoPresentationState): string {
  return JSON.stringify(state);
}

/** Structured error returned by `deserializeState` for invalid input. */
export type DeserializeError = { errorType: string; message: string };

function isIsoDateString(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Deserialises a JSON string to `YotoPresentationState`.
 *
 * Validates all required fields and the `balanceMode` enum.
 * Returns a `DeserializeError` — never a partial state — for any invalid input.
 */
export function deserializeState(
  json: string
): YotoPresentationState | DeserializeError {
  // Step 1: Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      errorType: "parse_error",
      message: "Input is not valid JSON.",
    };
  }

  // Step 2: Must be a plain object
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      errorType: "parse_error",
      message: "Parsed value is not an object.",
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Step 3: Validate required fields
  const VALID_BALANCE_MODES: BalanceMode[] = ["hidden", "rounded", "exact"];

  if (
    typeof obj.balanceMode !== "string" ||
    !VALID_BALANCE_MODES.includes(obj.balanceMode as BalanceMode)
  ) {
    return {
      errorType: "parse_error",
      message: `Invalid or missing "balanceMode". Must be one of: ${VALID_BALANCE_MODES.join(", ")}.`,
    };
  }

  if (typeof obj.activityPromptId !== "string" || obj.activityPromptId === "") {
    return {
      errorType: "parse_error",
      message: 'Missing or invalid required field "activityPromptId" (must be a non-empty string).',
    };
  }

  if (typeof obj.generatedAt !== "string" || !isIsoDateString(obj.generatedAt)) {
    return {
      errorType: "parse_error",
      message: 'Missing or invalid required field "generatedAt" (must be a non-empty ISO 8601 string).',
    };
  }

  // Step 4: Validate optional fields if present
  if (obj.childDisplayName !== undefined && typeof obj.childDisplayName !== "string") {
    return {
      errorType: "parse_error",
      message: '"childDisplayName" must be a string if present.',
    };
  }

  if (
    obj.availableAmountPence !== undefined &&
    (!isInteger(obj.availableAmountPence) ||
      obj.availableAmountPence < 0)
  ) {
    return {
      errorType: "parse_error",
      message: '"availableAmountPence" must be a non-negative integer if present.',
    };
  }

  if (obj.goalName !== undefined && typeof obj.goalName !== "string") {
    return {
      errorType: "parse_error",
      message: '"goalName" must be a string if present.',
    };
  }

  if (
    obj.goalProgressPercent !== undefined &&
    (!isInteger(obj.goalProgressPercent) ||
      obj.goalProgressPercent < 0 ||
      obj.goalProgressPercent > 100)
  ) {
    return {
      errorType: "parse_error",
      message: '"goalProgressPercent" must be an integer from 0 to 100 if present.',
    };
  }

  if (
    obj.weeklyChangePence !== undefined &&
    !isInteger(obj.weeklyChangePence)
  ) {
    return {
      errorType: "parse_error",
      message: '"weeklyChangePence" must be an integer if present.',
    };
  }

  // Step 5: Construct and return the validated state object (never partial)
  const state: YotoPresentationState = {
    balanceMode: obj.balanceMode as BalanceMode,
    activityPromptId: obj.activityPromptId as string,
    generatedAt: obj.generatedAt as string,
  };

  if (obj.childDisplayName !== undefined) {
    state.childDisplayName = obj.childDisplayName as string;
  }
  if (obj.availableAmountPence !== undefined) {
    state.availableAmountPence = obj.availableAmountPence as number;
  }
  if (obj.goalName !== undefined) {
    state.goalName = obj.goalName as string;
  }
  if (obj.goalProgressPercent !== undefined) {
    state.goalProgressPercent = obj.goalProgressPercent as number;
  }
  if (obj.weeklyChangePence !== undefined) {
    state.weeklyChangePence = obj.weeklyChangePence as number;
  }

  return state;
}
