import { NextResponse } from "next/server";
import { getFamilyId, getConnection, upsertConnection } from "../../../../lib/yoto/db";
import { deriveStateForFamily } from "../../../../lib/yoto/presentation";
import type { BalanceMode } from "../../../../lib/yoto/types";

export const runtime = "nodejs";

const VALID_BALANCE_MODES: BalanceMode[] = ["hidden", "rounded", "exact"];

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { balanceMode } = body as { balanceMode?: unknown };

  if (
    typeof balanceMode !== "string" ||
    !VALID_BALANCE_MODES.includes(balanceMode as BalanceMode)
  ) {
    return NextResponse.json(
      {
        error: `Invalid balanceMode. Must be one of: ${VALID_BALANCE_MODES.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  try {
    const familyId = getFamilyId();
    upsertConnection({ familyId, balanceMode: balanceMode as BalanceMode });

    // If a playlist exists, trigger re-derivation of presentation state.
    const conn = getConnection(familyId);
    if (conn?.playlistId) {
      deriveStateForFamily(familyId);
    }

    return NextResponse.json({ ok: true, balanceMode }, { status: 200 });
  } catch (error) {
    console.error("[yoto/balance-mode] Failed to update balance mode", error);
    return NextResponse.json(
      { error: "Failed to update balance mode" },
      { status: 500 }
    );
  }
}
