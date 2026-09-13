import { NextResponse } from "next/server";
import { isPendingFlowExpired } from "../../../../lib/yoto/oauth";
import {
  clearPendingOAuth,
  getFamilyId,
  getConnection,
} from "../../../../lib/yoto/db";

export const runtime = "nodejs";

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
    console.error("[yoto/status] Failed to read connection status", error);
    return NextResponse.json(
      { error: "Failed to read Yoto connection status" },
      { status: 500 }
    );
  }
}
