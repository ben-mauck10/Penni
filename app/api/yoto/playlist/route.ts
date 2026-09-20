import { NextResponse } from "next/server";
import { getFamilyId, getConnection } from "../../../../lib/yoto/db";
import { createOrUpdatePlaylist } from "../../../../lib/yoto/playlist";

export const runtime = "nodejs";

function playlistErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return "Could not create or update the Yoto playlist. Please try again.";
}

export async function POST() {
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

    const { playlistId } = await createOrUpdatePlaylist(familyId);

    return NextResponse.json({ playlistId }, { status: 200 });
  } catch (error) {
    console.error("[yoto/playlist] Failed to create or update playlist", error);
    return NextResponse.json(
      {
        error: playlistErrorMessage(error),
      },
      { status: 502 }
    );
  }
}
