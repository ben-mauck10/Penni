// Icon Endpoint — serves a 16×16 RGBA PNG progress-bar icon for Yoto cards.
// Authenticated via an opaque media token (hashed, never logged).

export const runtime = "nodejs";

import { hashToken, verifySignedMediaToken } from "@/lib/yoto/crypto";
import { getDb, rowToConnection } from "@/lib/yoto/db";
import { deriveStateForFamily } from "@/lib/yoto/presentation";
import { generateIcon } from "@/lib/yoto/icon";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

function responseBody(buffer: Buffer): ArrayBuffer {
  const body = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(body).set(buffer);
  return body;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // 12.1 — Authentication

  const { token } = await params;

  // Hash the token and look up the connection — never log the raw token.
  const hash = hashToken(token);
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM yoto_connections WHERE media_token_hash = ?")
    .get(hash) as Record<string, unknown> | undefined;

  const familyId = row
    ? rowToConnection(row).familyId
    : verifySignedMediaToken(token);

  if (!familyId) {
    // Return 401 without body; no distinction between missing vs. invalid token.
    return new Response(null, { status: 401, headers: PRIVATE_NO_STORE });
  }

  // Derive presentation state for this family.
  //
  // Use the last synced presentation state. If the parent has not yet synced
  // one, deriveStateForFamily returns a generic hidden-balance fallback state.
  const state = deriveStateForFamily(familyId);
  if (!state) {
    const correlationId = crypto.randomUUID();
    console.error({ errorType: "state_unavailable", correlationId, status: 503 });
    return new Response(null, { status: 503, headers: PRIVATE_NO_STORE });
  }

  // Generate and return the PNG icon.
  const pngBuffer = generateIcon(state.goalProgressPercent);
  return new Response(responseBody(pngBuffer), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
    },
  });
}
