// Playlist Service: creates and updates the "Penni Pig" Yoto MYO content.
// Uses Yoto Labs TTS so Yoto generates and hosts playable audio.

import { ensureFreshToken } from "./oauth";
import { getConnection, upsertConnection } from "./db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const YOTO_LABS_API_URL =
  process.env.YOTO_LABS_API_URL ?? "https://labs.api.yotoplay.com";
const YOTO_LABS_VOICE_ID =
  process.env.YOTO_LABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
const YOTO_API_URL = process.env.YOTO_API_URL ?? "https://api.yotoplay.com";
const PENNI_CARD_TITLE = "Penni Pig";

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
 * Constructs a Yoto Labs text-to-speech payload for the "Penni Pig" card.
 * The Labs API converts these text tracks into Yoto-hosted audio.
 */
export function buildPlaylistPayload(): object {
  const chapters = [
    {
      key: "01-update",
      title: "My Penni update",
      tracks: [
        {
          key: "01-update-track",
          title: "My Penni update",
          trackUrl:
            "Hello from Penni Pig. Your savings update is ready. Keep going, you are doing brilliantly.",
          type: "elevenlabs",
          overlayLabel: "1",
          display: {},
        },
      ],
      display: {},
    },
    {
      key: "02-changed",
      title: "What changed?",
      tracks: [
        {
          key: "02-changed-track",
          title: "What changed?",
          trackUrl:
            "What changed this week? Your Penni Pig card is ready to help you talk about saving, spending, and giving.",
          type: "elevenlabs",
          overlayLabel: "2",
          display: {},
        },
      ],
      display: {},
    },
    {
      key: "03-moment",
      title: "Family money moment",
      tracks: [
        {
          key: "03-moment-track",
          title: "Family money moment",
          trackUrl:
            "Family money moment. Pick one thing you might save for, one thing you might spend on, and one kind thing you could give.",
          type: "elevenlabs",
          overlayLabel: "3",
          display: {},
        },
      ],
      display: {},
    },
  ];

  return {
    title: "Penni Pig",
    content: {
      chapters,
      config: { resumeTimeout: 0 },
      playbackType: "linear",
    },
    metadata: {
      title: "Penni Pig",
      description: "A child-friendly Penni Pig savings update.",
      category: "activity",
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

function isCardId(value: string | null | undefined): value is string {
  return /^[a-zA-Z0-9]{5}$/.test(value ?? "");
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

async function findPenniPigCardId(accessToken: string): Promise<string | null> {
  const response = await fetch(`${YOTO_API_URL}/content/mine`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { cards?: unknown };
  if (!Array.isArray(data.cards)) {
    return null;
  }

  const cards = data.cards as Record<string, unknown>[];
  const penniCards = cards
    .filter((card) => card.title === PENNI_CARD_TITLE)
    .filter((card) => card.deleted !== true)
    .sort((a, b) => {
      const aTime = Date.parse(String(a.updatedAt ?? a.createdAt ?? ""));
      const bTime = Date.parse(String(b.updatedAt ?? b.createdAt ?? ""));
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });

  const cardId = penniCards[0]?.cardId;
  return typeof cardId === "string" && isCardId(cardId) ? cardId : null;
}

async function isCardAudioReady(
  accessToken: string,
  cardId: string
): Promise<boolean | null> {
  const response = await fetch(`${YOTO_API_URL}/content/${cardId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as Record<string, unknown>;
  const card = (data.card ?? data) as Record<string, unknown>;
  const content = card.content as Record<string, unknown> | undefined;
  const chapters = content?.chapters;
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return false;
  }

  for (const chapter of chapters) {
    if (typeof chapter !== "object" || chapter === null) {
      return false;
    }

    const tracks = (chapter as Record<string, unknown>).tracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return false;
    }

    for (const track of tracks) {
      if (typeof track !== "object" || track === null) {
        return false;
      }

      const trackObj = track as Record<string, unknown>;
      if (trackObj.type === "elevenlabs") {
        return false;
      }
      if (typeof trackObj.trackUrl !== "string" || trackObj.trackUrl.length === 0) {
        return false;
      }
    }
  }

  return true;
}

async function waitForPenniPigCardId(accessToken: string): Promise<string | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cardId = await findPenniPigCardId(accessToken);
    if (cardId) {
      const audioReady = await isCardAudioReady(accessToken, cardId);
      if (audioReady === true || audioReady === null) {
        return cardId;
      }
    }
    await sleep(2_000);
  }

  return null;
}

// ---------------------------------------------------------------------------
// 9.2 — createOrUpdatePlaylist
// ---------------------------------------------------------------------------

/**
 * Creates or updates the "Penni Pig" Yoto card for the given family.
 *
 * - Obtains a fresh access token via `ensureFreshToken`.
 * - POSTs text tracks to the Yoto Labs TTS job API.
 * - Includes `cardId` when updating existing content.
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
  familyId: string
): Promise<{ playlistId: string }> {
  // Step 1: Obtain a valid access token.
  const accessToken = await ensureFreshToken(familyId);

  // Step 2: Read the current connection record.
  const conn = getConnection(familyId);

  // Step 3: Build the Yoto Labs TTS payload.
  const payload = buildPlaylistPayload() as Record<string, unknown>;

  // Step 4: Call the Yoto Labs API (with retry).
  const existingPlaylistId = isCardId(conn?.playlistId) ? conn.playlistId : null;

  const returnedJob = await withRetry(async () => {
    const url = new URL(`${YOTO_LABS_API_URL}/content/job`);
    url.searchParams.set("voiceId", YOTO_LABS_VOICE_ID);
    const method = "POST";
    const body = existingPlaylistId
      ? { cardId: existingPlaylistId, ...payload }
      : payload;

    const response = await fetch(url.toString(), {
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
        `Yoto Labs API ${method} ${url.toString()} responded with ${response.status}: ${errorText}`,
        response.status
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const job = data.job as Record<string, unknown> | undefined;
    const card = data.card as Record<string, unknown> | undefined;
    const cardId = (card?.cardId ?? job?.cardId ?? data.cardId) as
      | string
      | undefined;
    const jobId = (job?.jobId ?? data.jobId ?? data.id) as string | undefined;

    if (!cardId && !jobId) {
      throw new PlaylistApiError(
        `Yoto Labs API response missing jobId/cardId fields`,
        200
      );
    }

    return { cardId: isCardId(cardId) ? cardId : null, jobId: jobId ?? null };
  });

  let returnedPlaylistId: string | null = null;
  if (returnedJob.cardId) {
    const audioReady = await isCardAudioReady(accessToken, returnedJob.cardId);
    returnedPlaylistId = audioReady === true ? returnedJob.cardId : null;
  }
  returnedPlaylistId ??= await waitForPenniPigCardId(accessToken);

  if (!returnedPlaylistId) {
    throw new PlaylistApiError(
      "Yoto accepted the text-to-speech job, but the Penni Pig card audio is still being generated. Wait a minute, then click Test / regenerate again before linking it to a MYO card.",
      202
    );
  }

  // Step 5: Persist success.
  upsertConnection({
    familyId,
    status: "playlist_ready",
    playlistId: returnedPlaylistId,
  });

  return { playlistId: returnedPlaylistId };
}
