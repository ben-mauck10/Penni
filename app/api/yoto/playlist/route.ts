import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { getFamilyId, getConnection } from "../../../../lib/yoto/db";
import { createOrUpdatePlaylist } from "../../../../lib/yoto/playlist";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const familyId = getFamilyId();
    const conn = getConnection(familyId);

    if (
      !conn ||
      conn.status === "not_connected" ||
      conn.status === "needs_attention"
    ) {
      return NextResponse.json(
        { error: "Yoto connection required before creating a playlist." },
        { status: 400 }
      );
    }

    const origin = req.nextUrl.origin;
    const { playlistId } = await createOrUpdatePlaylist(familyId, origin);

    return NextResponse.json({ playlistId }, { status: 200 });
  } catch (error) {
    console.error("[yoto/playlist] Failed to create or update playlist", error);
    return NextResponse.json(
      {
        error:
          "Could not create or update the Yoto playlist. Please try again.",
      },
      { status: 502 }
    );
  }
}
