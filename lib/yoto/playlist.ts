// Playlist Service: creates and updates the "Penni Pig" Yoto MYO content.
// Uses the Yoto content API (POST /content for create and update).

import { ensureFreshToken } from "./oauth";
import { getConnection, upsertConnection } from "./db";
import { generateSecureToken, hashToken } from "./crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const YOTO_API_URL = process.env.YOTO_API_URL ?? "https://api.yotoplay.com";

/** Maximum number of attempts (initial try + 2 retries). */
const MAX_ATTEMPTS = 3;

/** Initial back-off delay in milliseconds. */
const INITIAL_BACKOFF_MS = 1_000;

/** Maximum back-off delay in milliseconds. */
const MAX_BACKOFF_MS = 30_000;

// ---------------------------------------------------------------------------
// 9.1 — buildPlaylistPayload
// ---------------------------------------------------------------------------

/**
 * Constructs the Yoto card/playlist payload for the "Penni Pig" card.
 *
 * Contains exactly three chapters, each using `mediaToken` as an opaque
 * identifier in URL paths — no family IDs, child names, or PII.
 *
 * @param origin    - The public base URL of this Penni deployment (e.g. "https://penni.example.com").
 * @param mediaToken - The plaintext Media Access Token for this family.
 * @returns A plain object matching the Yoto card payload shape.
 */
export function buildPlaylistPayload(
  origin: string,
  mediaToken: string
): object {
  const iconUrl = `${origin}/api/yoto/icon/${mediaToken}`;
  const chapters = [
    {
      key: "01-update",
      title: "My Penni update",
      tracks: [
        {
          key: "01-update-track",
          title: "My Penni update",
          trackUrl: `${origin}/api/yoto/audio/${mediaToken}/update`,
          format: "mp3",
          type: "stream",
          uid: "",
          duration: 30,
          fileSize: 0,
          channels: "mono",
          overlayLabel: "1",
          display: { iconUrl16x16: iconUrl },
        },
      ],
      defaultTrackDisplay: null,
      defaultTrackAmbient: null,
      display: { iconUrl16x16: iconUrl },
    },
    {
      key: "02-changed",
      title: "What changed?",
      tracks: [
        {
          key: "02-changed-track",
          title: "What changed?",
          trackUrl: `${origin}/api/yoto/audio/${mediaToken}/changed`,
          format: "mp3",
          type: "stream",
          uid: "",
          duration: 30,
          fileSize: 0,
          channels: "mono",
          overlayLabel: "2",
          display: { iconUrl16x16: iconUrl },
        },
      ],
      defaultTrackDisplay: null,
      defaultTrackAmbient: null,
      display: { iconUrl16x16: iconUrl },
    },
    {
      key: "03-moment",
      title: "Family money moment",
      tracks: [
        {
          key: "03-moment-track",
          title: "Family money moment",
          trackUrl: `${origin}/api/yoto/audio/${mediaToken}/moment`,
          format: "mp3",
          type: "stream",
          uid: "",
          duration: 30,
          fileSize: 0,
          channels: "mono",
          overlayLabel: "3",
          display: { iconUrl16x16: iconUrl },
        },
      ],
      defaultTrackDisplay: null,
      defaultTrackAmbient: null,
      display: { iconUrl16x16: iconUrl },
    },
  ];

  return {
    title: "Penni Pig",
    content: {
      chapters,
      config: {
        autoadvance: "next",
        onlineOnly: true,
        resumeTimeout: 0,
      },
      playbackType: "linear",
    },
    metadata: {
      description: "A child-friendly Penni Pig savings update.",
      category: "activities",
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns true for errors that should trigger a retry (network / 5xx). */
function isRetryable(err: unknown): boolean {
  if (err instanceof PlaylistApiError) {
    return err.statusCode >= 500;
  }
  // Non-PlaylistApiError means a network/fetch-level failure.
  return true;
}

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

/**
 * Calls the Yoto API with exponential back-off retry for network / 5xx errors.
 *
 * @param fn - Async function that performs one attempt and either resolves or throws.
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

  // Should be unreachable, but satisfy the TypeScript control-flow analysis.
  throw lastError;
}

// ---------------------------------------------------------------------------
// 9.2 — createOrUpdatePlaylist
// ---------------------------------------------------------------------------

/**
 * Creates or updates the "Penni Pig" Yoto card for the given family.
 *
 * - Obtains a fresh access token via `ensureFreshToken`.
 * - Provisions a Media Access Token if one does not yet exist (stores only
 *   its SHA-256 hash in the Connection Store — never the plaintext).
 * - POSTs to `/content`; includes `cardId` when updating existing content.
 * - Retries on network failures and 5xx responses with exponential back-off
 *   (initial 1 s, doubling each attempt, max 30 s, max 3 attempts total).
 * - On 4xx errors: throws `{ errorType: "playlist_api_error" }` without
 *   overwriting the existing `playlistId`.
 *
 * @param familyId - Identifies this family's connection record.
 * @param origin   - The public base URL of this Penni deployment.
 * @returns `{ playlistId }` — the Yoto card ID stored in the Connection Store.
 */
export async function createOrUpdatePlaylist(
  familyId: string,
  origin: string
): Promise<{ playlistId: string }> {
  // Step 1: Obtain a valid access token.
  const accessToken = await ensureFreshToken(familyId);

  // Step 2: Read the current connection record.
  const conn = getConnection(familyId);

  // Step 3: Resolve or generate the Media Access Token.
  //  - Only the hash is persisted; the plaintext is used only in playlist URLs.
  let mediaToken: string;

  if (!conn?.mediaTokenHash) {
    // No token yet — generate one and store only its hash.
    mediaToken = generateSecureToken(16); // ≥128 bits of entropy
    upsertConnection({ familyId, mediaTokenHash: hashToken(mediaToken) });
  } else {
    // A token already exists but we never stored the plaintext.
    // We must regenerate a fresh token and re-embed it in the playlist so that
    // the stored hash reflects the token in the live playlist URLs.
    // The new hash atomically replaces the old one after the API call succeeds
    // (see Step 6 below where we write to DB only on success).
    //
    // If there is already a playlistId the existing token's URLs are still
    // valid until we push the updated playlist; we update the hash at the same
    // time as the successful PUT so there is never a window where the URL token
    // doesn't match the stored hash.
    mediaToken = generateSecureToken(16);
  }

  // Step 4: Build the payload.
  const payload = buildPlaylistPayload(origin, mediaToken);

  // Step 5: Call the Yoto API (with retry).
  const existingPlaylistId = conn?.playlistId ?? null;

  const returnedPlaylistId = await withRetry(async () => {
    const isCreate = !existingPlaylistId;
    const url = `${YOTO_API_URL}/content`;
    const method = "POST";
    const body = isCreate
      ? payload
      : { cardId: existingPlaylistId, ...payload };

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "(unreadable body)");
      throw new PlaylistApiError(
        `Yoto API ${method} ${url} responded with ${response.status}: ${errorText}`,
        response.status
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const card = data.card as Record<string, unknown> | undefined;
    const id = (card?.cardId ?? data.cardId ?? data.id) as string | undefined;

    if (!id) {
      throw new PlaylistApiError(
        `Yoto API response missing both 'id' and 'cardId' fields`,
        200
      );
    }

    return id;
  });

  // Step 6: Persist success — update hash + status + playlistId atomically.
  upsertConnection({
    familyId,
    mediaTokenHash: hashToken(mediaToken),
    status: "playlist_ready",
    playlistId: returnedPlaylistId,
  });

  return { playlistId: returnedPlaylistId };
}
