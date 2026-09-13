import { NextResponse } from "next/server";
import { getFamilyId, getConnection, savePresentationState } from "@/lib/yoto/db";
import { deriveState, serializeState } from "@/lib/yoto/presentation";
import type { PenniPlan, SaveGoal } from "@/lib/types";

export const runtime = "nodejs";

function parsePlan(value: unknown): PenniPlan | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const obj = value as Record<string, unknown>;
  const pots = obj.pots as Record<string, unknown> | undefined;

  if (
    typeof obj.currency !== "string" ||
    typeof obj.lastBalanceAmount !== "number" ||
    typeof pots?.spend !== "number" ||
    typeof pots.save !== "number" ||
    typeof pots.give !== "number" ||
    !Array.isArray(obj.saveGoals)
  ) {
    return null;
  }

  const saveGoals: SaveGoal[] = [];
  for (const goal of obj.saveGoals) {
    if (typeof goal !== "object" || goal === null || Array.isArray(goal)) {
      return null;
    }
    const goalObj = goal as Record<string, unknown>;
    if (
      typeof goalObj.id !== "string" ||
      typeof goalObj.name !== "string" ||
      typeof goalObj.target !== "number"
    ) {
      return null;
    }
    if (
      goalObj.allocated !== undefined &&
      typeof goalObj.allocated !== "number"
    ) {
      return null;
    }

    saveGoals.push({
      id: goalObj.id,
      name: goalObj.name,
      target: goalObj.target,
      allocated: goalObj.allocated as number | undefined,
    });
  }

  return {
    currency: obj.currency,
    lastBalanceAmount: obj.lastBalanceAmount,
    pots: {
      spend: pots.spend,
      save: pots.save,
      give: pots.give,
    },
    saveGoals,
  };
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { plan?: unknown; weeklyChangePence?: unknown };
  const plan = parsePlan(payload.plan);
  if (!plan) {
    return NextResponse.json({ error: "Invalid Penni plan" }, { status: 400 });
  }

  if (
    payload.weeklyChangePence !== undefined &&
    !Number.isInteger(payload.weeklyChangePence)
  ) {
    return NextResponse.json(
      { error: "Invalid weekly change value" },
      { status: 400 }
    );
  }
  const weeklyChangePence = payload.weeklyChangePence as number | undefined;

  try {
    const familyId = getFamilyId();
    const balanceMode = getConnection(familyId)?.balanceMode ?? "hidden";
    const state = deriveState(plan, balanceMode, {
      weeklyChangePence,
    });

    savePresentationState(familyId, serializeState(state));
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("[yoto/presentation] Failed to save presentation state", {
      errorType: error instanceof Error ? error.constructor.name : "unknown_error",
    });
    return NextResponse.json(
      { error: "Failed to update Yoto presentation" },
      { status: 500 }
    );
  }
}
