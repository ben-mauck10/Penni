// Audio Endpoint — serves synthesised MP3 audio for Yoto card chapters.
// Authenticated via an opaque media token (hashed, never logged).

export const runtime = "nodejs";

import { hashToken } from "@/lib/yoto/crypto";
import { getDb, rowToConnection } from "@/lib/yoto/db";
import { deriveStateForFamily } from "@/lib/yoto/presentation";
import { getScriptForChapter, getTTSAdapter } from "@/lib/yoto/tts";

// The valid chapter keys this endpoint accepts.
const VALID_CHAPTERS = ["update", "changed", "moment"] as const;
type ValidChapter = (typeof VALID_CHAPTERS)[number];

function isValidChapter(c: string): c is ValidChapter {
  return (VALID_CHAPTERS as readonly string[]).includes(c);
}

// Standard headers applied to every audio response.
const AUDIO_HEADERS = {
  "Content-Type": "audio/mpeg",
  "Cache-Control": "private, no-store",
};

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

function responseBody(buffer: Buffer): ArrayBuffer {
  const body = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(body).set(buffer);
  return body;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; chapter: string }> }
) {
  // 11.1 — Authentication and chapter validation

  const { token, chapter } = await params;

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

  // Validate the chapter parameter.
  if (!isValidChapter(chapter)) {
    return new Response(null, { status: 404, headers: PRIVATE_NO_STORE });
  }

  const connection = rowToConnection(row);
  const familyId = connection.familyId;

  // 11.2 — Chapter response logic

  // ── Chapters: TTS-synthesised speech ──────────────────────────────────────

  // Use the last synced presentation state. If the parent has not yet synced
  // one, deriveStateForFamily returns a generic hidden-balance fallback state.
  const state = deriveStateForFamily(familyId);
  if (!state) {
    const correlationId = crypto.randomUUID();
    console.error({ errorType: "state_unavailable", correlationId, status: 503 });
    return new Response(null, { status: 503, headers: PRIVATE_NO_STORE });
  }

  const script = getScriptForChapter(chapter, state);

  try {
    const mp3Buffer = await getTTSAdapter().synthesize(script);
    return new Response(responseBody(mp3Buffer), { status: 200, headers: AUDIO_HEADERS });
  } catch (err: unknown) {
    const correlationId = crypto.randomUUID();
    const errorType =
      err && typeof err === "object" && "errorType" in err
        ? (err as { errorType: string }).errorType
        : "tts_error";
    console.error({ errorType, correlationId, status: 503 });
    return new Response(null, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
