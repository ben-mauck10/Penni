// Audio Endpoint — serves static spoken audio for Yoto card chapters.
// Authenticated via an opaque media token (hashed, never logged).

export const runtime = "nodejs";

import fs from "fs";
import path from "path";
import { hashToken, verifySignedMediaToken } from "@/lib/yoto/crypto";
import { getDb } from "@/lib/yoto/db";

// The valid chapter keys this endpoint accepts.
const VALID_CHAPTERS = ["update", "changed", "moment"] as const;
type ValidChapter = (typeof VALID_CHAPTERS)[number];

function isValidChapter(c: string): c is ValidChapter {
  return (VALID_CHAPTERS as readonly string[]).includes(c);
}

// Standard headers applied to every audio response.
const AUDIO_HEADERS = {
  "Content-Type": "audio/aiff",
  "Cache-Control": "private, no-store",
};

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

function responseBody(buffer: Buffer): ArrayBuffer {
  const body = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(body).set(buffer);
  return body;
}

const STATIC_AUDIO_FILES: Record<ValidChapter, string> = {
  update: "update.aiff",
  changed: "changed.aiff",
  moment: "moment.aiff",
};

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

  // Validate the chapter parameter.
  if (!isValidChapter(chapter)) {
    return new Response(null, { status: 404, headers: PRIVATE_NO_STORE });
  }

  const validMediaToken = row !== undefined || verifySignedMediaToken(token) !== null;

  if (!validMediaToken) {
    // Return 401 without body; no distinction between missing vs. invalid token.
    return new Response(null, { status: 401, headers: PRIVATE_NO_STORE });
  }

  try {
    const audioPath = path.join(
      process.cwd(),
      "public",
      "yoto",
      STATIC_AUDIO_FILES[chapter]
    );
    const audioBuffer = fs.readFileSync(audioPath);
    return new Response(responseBody(audioBuffer), {
      status: 200,
      headers: AUDIO_HEADERS,
    });
  } catch (err: unknown) {
    const correlationId = crypto.randomUUID();
    const errorType = err instanceof Error ? err.constructor.name : "audio_error";
    console.error({ errorType, correlationId, status: 503 });
    return new Response(null, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
