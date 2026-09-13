import { NextResponse } from "next/server";
import { getFamilyId, getConnection } from "../../../../lib/yoto/db";
import { revokeTokens, ensureFreshToken } from "../../../../lib/yoto/oauth";

export const runtime = "nodejs";

const YOTO_API_URL = process.env.YOTO_API_URL ?? "https://api.yotoplay.com";

export async function DELETE(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Body is optional — default to no playlist deletion.
    body = {};
  }

  const { deletePlaylist } = (body ?? {}) as { deletePlaylist?: boolean };

  let playlistDeleted: boolean | undefined;
  let playlistDeleteError: string | undefined;

  try {
    const familyId = getFamilyId();
    const conn = getConnection(familyId);

    if (conn && deletePlaylist === true && conn.playlistId) {
      // Attempt to delete the Yoto card via the API.
      try {
        const accessToken = await ensureFreshToken(familyId);
        const deleteUrl = `${YOTO_API_URL}/content/${conn.playlistId}`;

        const response = await fetch(deleteUrl, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (response.ok) {
          playlistDeleted = true;
        } else {
          playlistDeleteError = `Yoto API returned HTTP ${response.status} when deleting playlist`;
        }
      } catch (err) {
        playlistDeleteError =
          err instanceof Error
            ? err.message
            : "Unknown error deleting Yoto playlist";
      }
    }

    // Always revoke tokens and delete the local connection record.
    await revokeTokens(familyId);

    const result: Record<string, unknown> = { ok: true };
    if (playlistDeleted !== undefined) result.playlistDeleted = playlistDeleted;
    if (playlistDeleteError !== undefined)
      result.playlistDeleteError = playlistDeleteError;

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[yoto/connection] Failed to disconnect Yoto", error);
    return NextResponse.json(
      { error: "Failed to disconnect Yoto account" },
      { status: 500 }
    );
  }
}
