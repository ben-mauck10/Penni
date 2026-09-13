// Icon Endpoint — serves a 16×16 RGBA PNG progress-bar icon for Yoto cards.
// Authenticated via an opaque media token (hashed, never logged).

export const runtime = "nodejs";

import { hashToken } from "@/lib/yoto/crypto";
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

  if (!row) {
    // Return 401 without body; no distinction between missing vs. invalid token.
    return new Response(null, { status: 401, headers: PRIVATE_NO_STORE });
  }

  const connection = rowToConnection(row);
  const familyId = connection.familyId;

  // Derive presentation state for this family.
  //
  // NOTE: deriveStateForFamily calls readPlan() from lib/storage, which guards
  // against server-side execution with `typeof window === "undefined"` — it will
  // always return null in this Node.js API route. This endpoint will therefore
  // respond 503 until the architecture evolves to persist plan data server-side
  // (e.g. in the SQLite DB). This behaviour is intentional for the current MVP.
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
