// Playlist Service: creates and updates the "Penni Pig" Yoto MYO card.
//
// Audio pipeline (per chapter):
//   1. Synthesise MP3 audio via ElevenLabs (mp3_44100_128, mono).
//   2. SHA-256 hash the buffer (required by Yoto's upload-url endpoint).
//   3. GET /media/audio/upload-url?sha256=<hex>&filename=<name> → { uploadId, url }.
//   4. PUT the MP3 bytes to the signed S3 URL.
//   5. Build the card payload with uploadId references.
//   6. POST /content (create) or PUT /content/<cardId> (update).
//
// Using uploadId references means Yoto transcodes and stores the audio on its
// own CDN, so the physical MYO card can download and play the tracks offline.
// The previous approach used Yoto Labs TTS which produces streaming-only URLs
// that require an internet connection on the physical device.

import { ensureFreshToken } from "./oauth";
import { getConnection, upsertConnection } from "./db";
import { getTTSAdapter, getScriptForChapter } from "./tts";
import type { YotoPresentationState } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const YOTO_API_URL = process.env.YOTO_API_URL ?? "https://api.yotoplay.com";
const PENNI_CARD_TITLE = "Penni Pig";

/** Chapter definitions — order and keys are stable identifiers on the card. */
const CHAPTERS = [
  { key: "01-update", title: "My Penni update",      chapterType: "update"  as const },
  { key: "02-changed", title: "What changed?",        chapterType: "changed" as const },
  { key: "03-moment", title: "Family money moment",   chapterType: "moment"  as const },
] satisfies { key: string; title: string; chapterType: "update" | "changed" | "moment" }[];

/** Maximum number of attempts (initial try + 2 retries). */
const MAX_ATTEMPTS = 3;

/** Initial back-off delay in milliseconds. */
const INITIAL_BACKOFF_MS = 1_000;

/** Maximum back-off delay in milliseconds. */
const MAX_BACKOFF_MS = 30_000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Waits for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


/**
 * Structured error thrown for non-retryable Yoto API errors (4xx).
 */
class PlaylistApiError extends Error {
  readonly errorType = "playlist_api_error";
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "PlaylistApiError";
    this.statusCode = statusCode;
  }
}

/** Returns true for errors that should trigger a retry (network / 5xx). */
function isRetryable(err: unknown): boolean {
  if (err instanceof PlaylistApiError) {
    return err.statusCode >= 500;
  }
  // Non-PlaylistApiError means a network/fetch-level failure.
  return true;
}

/**
 * Calls an async operation with exponential back-off retry for network / 5xx
 * errors.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  let backoffMs = INITIAL_BACKOFF_MS;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) {
        throw err;
      }

      await sleep(Math.min(backoffMs, MAX_BACKOFF_MS));
      backoffMs *= 2;
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// 9.1 — synthesiseChapter
// ---------------------------------------------------------------------------

/**
 * Calls ElevenLabs to synthesise MP3 audio for a single chapter script.
 * Returns the raw MP3 buffer.
 */
export async function synthesiseChapter(script: string): Promise<Buffer> {
  const adapter = getTTSAdapter();
  return adapter.synthesize(script);
}

// ---------------------------------------------------------------------------
// 9.2 — uploadAudioToYoto
// ---------------------------------------------------------------------------

/**
 * Uploads an MP3 buffer to Yoto's media store and waits for transcoding.
 *
 * Steps:
 *   1. POST /uploads/request → { uploadId, uploadUrl }
 *   2. PUT the MP3 bytes to the signed uploadUrl (no auth header — S3).
 *   3. Poll GET /uploads/{uploadId} until transcodedSha256 is available.
 *
 * @returns The `transcodedSha256` string used as `trackUrl: "yoto:#<hash>"`.
 */
export async function uploadAudioToYoto(
  accessToken: string,
  audioBuffer: Buffer
): Promise<string> {
  // Step 1: Request a signed upload URL from Yoto.
  const { uploadId, uploadUrl } = await withRetry(async () => {
    const res = await fetch(`${YOTO_API_URL}/media/transcode/audio/uploadUrl`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");
      throw new PlaylistApiError(
        `Yoto /media/transcode/audio/uploadUrl failed (${res.status}): ${text}`,
        res.status
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    const uploadId = data.uploadId ?? data.upload_id ?? data.id;
    const uploadUrl = data.uploadUrl ?? data.url ?? data.signedUrl;

    if (typeof uploadId !== "string" || typeof uploadUrl !== "string") {
      throw new PlaylistApiError(
        `Yoto /media/transcode/audio/uploadUrl response missing uploadId/uploadUrl: ${JSON.stringify(data)}`,
        200
      );
    }

    return { uploadId: uploadId as string, uploadUrl: uploadUrl as string };
  });

  // Step 2: PUT the audio bytes to the signed S3 URL.
  // No Authorization header — the signature is embedded in the URL itself.
  await withRetry(async () => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "audio/mpeg" },
      body: new Uint8Array(audioBuffer),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");
      throw new PlaylistApiError(
        `Audio PUT to signed URL failed (${res.status}): ${text}`,
        res.status
      );
    }
  });

  // Step 3: Poll until Yoto finishes transcoding.
  // Up to 20 attempts × 2 s = 40 seconds max.
  const MAX_POLL = 20;
  const POLL_INTERVAL_MS = 2_000;

  for (let attempt = 0; attempt < MAX_POLL; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(`${YOTO_API_URL}/media/upload/${uploadId}/transcoded?loudnorm=false`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) continue;

    const data = (await res.json()) as Record<string, unknown>;
    const hash = data.transcodedSha256 ?? data.sha256;

    if (typeof hash === "string" && hash.length > 0) {
      return hash;
    }
  }

  throw new PlaylistApiError(
    `Yoto transcoding timed out for upload ${uploadId} after ${MAX_POLL} attempts.`,
    202
  );
}

// ---------------------------------------------------------------------------
// 9.3 — buildCardPayload
// ---------------------------------------------------------------------------

/**
 * Constructs the Yoto card payload using transcoded audio hashes.
 *
 * @param transcodedHashes - Map from chapter key to Yoto transcodedSha256 hash.
 */
export function buildCardPayload(
  transcodedHashes: Record<string, string>
): Record<string, unknown> {
  const chapters = CHAPTERS.map(({ key, title }) => ({
    key,
    title,
    tracks: [
      {
        key: `${key}-track`,
        title,
        format: "mp3",
        channels: "mono",
        // "yoto:#<transcodedSha256>" tells Yoto to serve the uploaded audio.
        // This is what allows the MYO card to download tracks for offline play.
        trackUrl: `yoto:#${transcodedHashes[key]}`,
      },
    ],
    display: {},
  }));

  return {
    title: PENNI_CARD_TITLE,
    content: {
      chapters,
      config: { resumeTimeout: 0 },
      playbackType: "linear",
    },
    metadata: {
      title: PENNI_CARD_TITLE,
      description: "A child-friendly Penni Pig savings update.",
      category: "activity",
    },
  };
}

// ---------------------------------------------------------------------------
// 9.4 — createOrUpdatePlaylist
// ---------------------------------------------------------------------------

/**
 * Creates or updates the "Penni Pig" Yoto card for the given family.
 *
 * Flow:
 *   1. Obtain a fresh access token.
 *   2. For each of the three chapters, synthesise audio via ElevenLabs and
 *      upload it to Yoto's media store.
 *   3. Build the card payload with `uploadId` references.
 *   4. POST /content (first-time create) or PUT /content/<cardId> (update).
 *   5. Persist the returned cardId and set status to `playlist_ready`.
 *
 * Using `uploadId` references means Yoto hosts and transcodes the audio itself,
 * so the physical MYO card can download the tracks for offline playback.
 *
 * @param familyId - Identifies this family's connection record.
 * @returns `{ playlistId }` — the Yoto card ID stored in the Connection Store.
 */
export async function createOrUpdatePlaylist(
  familyId: string,
  presentationState?: YotoPresentationState
): Promise<{ playlistId: string }> {
  // Step 1: Obtain a valid access token.
  const accessToken = await ensureFreshToken(familyId);

  // Step 2: Read the existing connection record (for the cardId, if updating).
  const conn = getConnection(familyId);
  const existingCardId =
    typeof conn?.playlistId === "string" && /^[a-zA-Z0-9]{5}$/.test(conn.playlistId)
      ? conn.playlistId
      : null;

  // Step 3: Synthesise and upload audio for all three chapters.
  const transcodedHashes: Record<string, string> = {};

  for (const { key, chapterType } of CHAPTERS) {
    const script = presentationState
      ? getScriptForChapter(chapterType, presentationState)
      : FALLBACK_SCRIPTS[chapterType];

    const audioBuffer = await synthesiseChapter(script);
    const hash = await uploadAudioToYoto(accessToken, audioBuffer);
    transcodedHashes[key] = hash;
  }

  // Step 4: Create or update the Yoto card.
  const payload = buildCardPayload(transcodedHashes);

  const cardId = await withRetry(async () => {
    const isUpdate = existingCardId !== null;
    const url = isUpdate
      ? `${YOTO_API_URL}/content/${existingCardId}`
      : `${YOTO_API_URL}/content`;
    const method = isUpdate ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        isUpdate ? { cardId: existingCardId, ...payload } : payload
      ),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");
      throw new PlaylistApiError(
        `Yoto ${method} ${url} failed (${res.status}): ${text}`,
        res.status
      );
    }

    const data = (await res.json()) as Record<string, unknown>;

    // Yoto may return the cardId at the top level or nested under `card`.
    const card = data.card as Record<string, unknown> | undefined;
    const returnedId = data.cardId ?? card?.cardId ?? existingCardId;

    if (typeof returnedId !== "string" || !/^[a-zA-Z0-9]{5}$/.test(returnedId)) {
      throw new PlaylistApiError(
        `Yoto card response missing or invalid cardId: ${JSON.stringify(data)}`,
        200
      );
    }

    return returnedId;
  });

  // Step 5: Persist success.
  upsertConnection({
    familyId,
    status: "playlist_ready",
    playlistId: cardId,
  });

  return { playlistId: cardId };
}

// ---------------------------------------------------------------------------
// Fallback scripts (used when no live presentation state is available)
// ---------------------------------------------------------------------------

const FALLBACK_SCRIPTS: Record<"update" | "changed" | "moment", string> = {
  update:
    "Hello from Penni Pig! Your savings update is ready. Keep going, you are doing brilliantly.",
  changed:
    "What changed this week? Your Penni Pig card is ready to help you talk about saving, spending, and giving.",
  moment:
    "Family money moment. Pick one thing you might save for, one thing you might spend on, and one kind thing you could give.",
};
