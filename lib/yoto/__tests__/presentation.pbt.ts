/**
 * Property-based tests for lib/yoto/presentation.ts
 *
 * Feature: yoto-integration
 * Validates: Requirements 6.1, 6.3
 */

import { describe, it } from "vitest";
import { expect } from "vitest";
import * as fc from "fast-check";
import {
  serializeState,
  deserializeState,
  deriveState,
} from "../presentation";
import type { YotoPresentationState } from "../types";
import type { PenniPlan } from "../../types";

// Set required env vars before any module-level code executes
process.env.YOTO_DB_PATH = ":memory:";
process.env.PENNI_FAMILY_ID = "test-family";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a valid BalanceMode string */
const balanceModeArb = fc.constantFrom("hidden", "rounded", "exact") as fc.Arbitrary<
  "hidden" | "rounded" | "exact"
>;

/**
 * Generates a valid YotoPresentationState object with all required fields
 * and randomly-present optional fields.
 */
const presentationStateArb: fc.Arbitrary<YotoPresentationState> = fc.record(
  {
    balanceMode: balanceModeArb,
    activityPromptId: fc.string({ minLength: 1 }),
    generatedAt: fc.date().map((d) => d.toISOString()),
    // Optional fields — use fc.option to make them randomly absent
    childDisplayName: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
    availableAmountPence: fc.option(
      fc.integer({ min: 0, max: 1_000_000 }),
      { nil: undefined }
    ),
    goalName: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
    goalProgressPercent: fc.option(
      fc.integer({ min: 0, max: 100 }),
      { nil: undefined }
    ),
    weeklyChangePence: fc.option(
      fc.integer({ min: -100_000, max: 100_000 }),
      { nil: undefined }
    ),
  },
  { requiredKeys: ["balanceMode", "activityPromptId", "generatedAt"] }
).map((record) => {
  // Strip out undefined optional keys so they are absent from the object
  const state: YotoPresentationState = {
    balanceMode: record.balanceMode,
    activityPromptId: record.activityPromptId,
    generatedAt: record.generatedAt,
  };
  if (record.childDisplayName !== undefined)
    state.childDisplayName = record.childDisplayName;
  if (record.availableAmountPence !== undefined)
    state.availableAmountPence = record.availableAmountPence;
  if (record.goalName !== undefined) state.goalName = record.goalName;
  if (record.goalProgressPercent !== undefined)
    state.goalProgressPercent = record.goalProgressPercent;
  if (record.weeklyChangePence !== undefined)
    state.weeklyChangePence = record.weeklyChangePence;
  return state;
});

/** Generates a minimal valid PenniPlan with arbitrary save-pot value */
const penniPlanArb = (savePounds?: fc.Arbitrary<number>): fc.Arbitrary<PenniPlan> =>
  fc.record({
    currency: fc.constant("GBP"),
    lastBalanceAmount: fc.double({ min: 0, max: 10_000, noNaN: true }),
    pots: fc.record({
      spend: fc.double({ min: 0, max: 5_000, noNaN: true }),
      save: savePounds ?? fc.double({ min: 0, max: 5_000, noNaN: true }),
      give: fc.double({ min: 0, max: 5_000, noNaN: true }),
    }),
    saveGoals: fc.constant([]),
  });

/** PenniPlan with at least one save goal where allocated >= target */
const planWithOverflowGoalArb: fc.Arbitrary<PenniPlan> = fc
  .record({
    target: fc.double({ min: 0.01, max: 1_000, noNaN: true }),
    extra: fc.double({ min: 0, max: 1_000, noNaN: true }),
  })
  .chain(({ target, extra }) =>
    fc.record({
      currency: fc.constant("GBP"),
      lastBalanceAmount: fc.double({ min: 0, max: 10_000, noNaN: true }),
      pots: fc.record({
        spend: fc.double({ min: 0, max: 5_000, noNaN: true }),
        save: fc.double({ min: 0, max: 5_000, noNaN: true }),
        give: fc.double({ min: 0, max: 5_000, noNaN: true }),
      }),
      saveGoals: fc.constant([
        {
          id: "goal-1",
          name: "My Goal",
          target,
          allocated: target + extra, // always >= target
        },
      ]),
    })
  );

// ---------------------------------------------------------------------------
// Property 1: YotoPresentationState serialisation round-trip
// ---------------------------------------------------------------------------

describe("Property 1: YotoPresentationState serialisation round-trip", () => {
  it("deserializeState(serializeState(state)) equals the original state", () => {
    // Feature: yoto-integration, Property 1: YotoPresentationState serialisation round-trip
    fc.assert(
      fc.property(presentationStateArb, (state) => {
        const serialized = serializeState(state);
        const result = deserializeState(serialized);
        expect(result).toEqual(state);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Invalid JSON deserialisation produces a structured error
// ---------------------------------------------------------------------------

describe("Property 2: Invalid JSON deserialisation produces a structured error", () => {
  it("malformed inputs return an object with errorType and message, never a valid state", () => {
    // Feature: yoto-integration, Property 2: Invalid JSON deserialisation produces a structured error
    const invalidInputs: fc.Arbitrary<string> = fc.oneof(
      // Completely invalid JSON
      fc.string().filter((s) => {
        try {
          JSON.parse(s);
          return false;
        } catch {
          return true;
        }
      }),
      // Valid JSON but missing required fields
      fc.constant("{}"),
      fc.constant('{"balanceMode":"hidden"}'),
      fc.constant('{"activityPromptId":"default","generatedAt":"2024-01-01T00:00:00.000Z"}'),
      // Wrong type for balanceMode
      fc.constant('{"balanceMode":42,"activityPromptId":"default","generatedAt":"2024-01-01T00:00:00.000Z"}'),
      // Invalid balanceMode value
      fc.constant('{"balanceMode":"invalid","activityPromptId":"default","generatedAt":"2024-01-01T00:00:00.000Z"}'),
      // Non-object JSON
      fc.constant('"just a string"'),
      fc.constant("null"),
      fc.constant("[]"),
      fc.constant("42"),
    );

    fc.assert(
      fc.property(invalidInputs, (input) => {
        const result = deserializeState(input);
        // Must have errorType and message
        expect(result).toHaveProperty("errorType");
        expect(result).toHaveProperty("message");
        // Must NOT be a valid YotoPresentationState (cannot have all three required state fields)
        const asAny = result as Record<string, unknown>;
        const hasAllStateFields =
          "balanceMode" in asAny &&
          "activityPromptId" in asAny &&
          "generatedAt" in asAny;
        expect(hasAllStateFields).toBe(false);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: hidden balance mode never exposes an amount
// ---------------------------------------------------------------------------

describe("Property 3: hidden balance mode never exposes an amount", () => {
  it("deriveState(plan, 'hidden') never includes availableAmountPence", () => {
    // Feature: yoto-integration, Property 3: hidden balance mode never exposes an amount
    fc.assert(
      fc.property(penniPlanArb(), (plan) => {
        const result = deriveState(plan, "hidden");
        expect("availableAmountPence" in result).toBe(false);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: rounded amounts are rounded to the nearest 100 pence
// ---------------------------------------------------------------------------

describe("Property 4: rounded amounts are rounded to the nearest 100 pence", () => {
  it("deriveState(plan, 'rounded').availableAmountPence is divisible by 100", () => {
    // Feature: yoto-integration, Property 4: rounded amounts are rounded to the nearest 100 pence
    fc.assert(
      fc.property(penniPlanArb(), (plan) => {
        const result = deriveState(plan, "rounded");
        expect(result.availableAmountPence).toBeDefined();
        expect(result.availableAmountPence! % 100).toBe(0);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: goalProgressPercent is always capped at 100
// ---------------------------------------------------------------------------

describe("Property 10: goalProgressPercent is always capped at 100", () => {
  it("goalProgressPercent === 100 when allocated >= target", () => {
    // Feature: yoto-integration, Property 10: goalProgressPercent is always capped at 100
    fc.assert(
      fc.property(planWithOverflowGoalArb, balanceModeArb, (plan, mode) => {
        const result = deriveState(plan, mode);
        expect(result.goalProgressPercent).toBe(100);
      }),
      { numRuns: 200 }
    );
  });
});
