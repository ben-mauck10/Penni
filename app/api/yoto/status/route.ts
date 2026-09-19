import { NextResponse } from "next/server";
import { isPendingFlowExpired } from "../../../../lib/yoto/oauth";
import {
  clearPendingOAuth,
  getFamilyId,
  getConnection,
} from "../../../../lib/yoto/db";

export const runtime = "nodejs";

function getStatusErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Failed to read Yoto connection status.";
  }

  if (error.message.includes("PENNI_FAMILY_ID")) {
    return "Missing PENNI_FAMILY_ID in the deployment environment.";
  }

  if (
    error.message.includes("SQLITE") ||
    error.message.includes("database") ||
    error.message.includes("readonly") ||
    error.message.includes("permission") ||
    error.message.includes("no such file")
  ) {
    return "Could not open the Yoto connection database. Check YOTO_DB_PATH is set to /tmp/yoto.db and redeploy.";
  }

  return "Failed to read Yoto connection status. Check Vercel runtime logs for /api/yoto/status.";
}

export async function GET() {
  try {
    const familyId = getFamilyId();
    const conn = getConnection(familyId);

    if (!conn) {
      return NextResponse.json({
        status: "not_connected",
        balanceMode: "hidden",
        yotoAccountId: null,
        playlistId: null,
      });
    }

    if (conn.status === "connecting" && isPendingFlowExpired(conn)) {
      clearPendingOAuth(familyId, "not_connected");
      return NextResponse.json({
        status: "not_connected",
        balanceMode: conn.balanceMode,
        yotoAccountId: null,
        playlistId: null,
        message: "The Yoto connection attempt has expired.",
      });
    }

    // Never include token fields in the response.
    return NextResponse.json({
      status: conn.status,
      yotoAccountId: conn.yotoAccountId,
      balanceMode: conn.balanceMode,
      playlistId: conn.playlistId,
    });
  } catch (error) {
    console.error("[yoto/status] Failed to read connection status", {
      errorType: error instanceof Error ? error.constructor.name : "unknown_error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: getStatusErrorMessage(error) },
      { status: 500 }
    );
  }
}
