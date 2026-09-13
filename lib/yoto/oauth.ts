// OAuth Service: Yoto authorization-code + PKCE flow, token refresh, and revocation.
// Mirrors the pattern in app/api/auth-link/route.ts and app/api/complete-bank-link/route.ts.
// Must only run in the Node.js runtime — never Edge.

import { generateSecureToken, buildPkceParams, encryptToken, decryptToken } from "./crypto";
import {
  getConnection,
  upsertConnection,
  deleteConnection,
} from "./db";
import type { YotoConnection, TokenPair } from "./types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns the Yoto auth base URL from env (default: production). */
function getAuthBase(): string {
  return process.env.YOTO_AUTH_URL ?? "https://login.yotoplay.com";
}

/** Throws a clear error if a required env var is absent. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it before starting the server.`
    );
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value : undefined;
}

/** Resolves after the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a short opaque correlation ID for structured error logs.
 * Never used as a secret — it is only an observability handle.
 */
function generateCorrelationId(): string {
  return generateSecureToken(8);
}

// ---------------------------------------------------------------------------
// 5.1 — buildAuthUrl
// ---------------------------------------------------------------------------

/**
 * Generates a complete Yoto authorization URL with PKCE and a random `state`.
 *
 * - `state` is derived from 16 CSPRNG bytes (128 bits), satisfying Requirement 1.4.
 * - `codeVerifier` is 43 URL-safe characters (32 random bytes → base64url).
 * - Scopes are limited to `user:content:manage offline_access` (Requirement 1.3 —
 *   `family:devices:control` is intentionally excluded).
 *
 * @param origin - The request origin (e.g. `https://penni.example.com`), used to
 *   build the `redirect_uri` parameter.
 * @returns `{ url, state, codeVerifier }` — the caller stores `state` and
 *   `codeVerifier` in an httpOnly cookie before redirecting.
 */
export function buildAuthUrl(
  origin: string
): { url: string; state: string; codeVerifier: string } {
  const clientId = requireEnv("YOTO_CLIENT_ID");
  const authBase = getAuthBase();

  const state = generateSecureToken(16); // ≥128 bits of entropy
  const { codeVerifier, codeChallenge } = buildPkceParams();

  const redirectUri = `${origin}/api/yoto/callback`;

  const params = new URLSearchParams({
    audience: "https://api.yotoplay.com",
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "user:content:manage offline_access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const url = `${authBase}/authorize?${params.toString()}`;

  return { url, state, codeVerifier };
}

// ---------------------------------------------------------------------------
// 5.2 — exchangeCode
// ---------------------------------------------------------------------------

/**
 * Exchanges an OAuth authorization code for an access + refresh token pair.
 *
 * On success:
 * - Encrypts both tokens via AES-256-GCM.
 * - Computes expiry as `Date.now() + expires_in * 1000`.
 * - Upserts the connection record with status `"connected_no_playlist"`.
 *
 * On failure:
 * - Throws `{ errorType: "exchange_failed", message }`.
 * - Never logs the raw response body (it may contain tokens).
 *
 * @param code         - The authorization code from the Yoto callback query param.
 * @param codeVerifier - The PKCE verifier stored at flow initiation.
 * @param familyId     - The Penni family identifier for the connection record.
 * @param origin       - Request origin used to reconstruct `redirect_uri`.
 */
export async function exchangeCode(
  code: string,
  codeVerifier: string,
  familyId: string,
  origin: string
): Promise<TokenPair> {
  const clientId = requireEnv("YOTO_CLIENT_ID");
  const clientSecret = optionalEnv("YOTO_CLIENT_SECRET");
  const authBase = getAuthBase();
  const redirectUri = `${origin}/api/yoto/callback`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  let response: Response;
  try {
    response = await fetch(`${authBase}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    throw {
      errorType: "exchange_failed",
      message:
        "Network error while exchanging authorization code. " +
        "Please check connectivity and try reconnecting.",
    };
  }

  if (!response.ok) {
    // Read status/statusText only — never log the response body which may contain tokens.
    throw {
      errorType: "exchange_failed",
      message: `Authorization code exchange failed (HTTP ${response.status}). Please try connecting again.`,
    };
  }

  // Parse response — do NOT spread/log the raw data object.
  let data: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type?: string;
    scope?: string;
    // Some Yoto responses may include a user/account identifier.
    account_id?: string;
    sub?: string;
  };

  try {
    data = await response.json();
  } catch {
    throw {
      errorType: "exchange_failed",
      message: "Malformed response from authorization server.",
    };
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  const encryptedAccessToken = encryptToken(data.access_token);
  const encryptedRefreshToken = encryptToken(data.refresh_token);

  const yotoAccountId = data.account_id ?? data.sub ?? null;

  upsertConnection({
    familyId,
    yotoAccountId,
    status: "connected_no_playlist",
    encryptedAccessToken,
    encryptedRefreshToken,
    accessTokenExpiresAt: expiresAt,
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// 5.3 — refreshTokens
// ---------------------------------------------------------------------------

/**
 * Refreshes the Yoto access token using the stored encrypted refresh token.
 *
 * Retry policy:
 * - 400/401: set `needs_attention`, throw immediately — do NOT retry.
 * - 5xx/network: retry up to 3 times with a 5-second pause between attempts;
 *   on exhaustion set `needs_attention` and throw.
 *
 * Rotation:
 * - If the response includes a new `refresh_token`, replace the stored one.
 * - If the response does NOT include a new `refresh_token`, retain the existing one.
 *
 * Security: this function never logs decrypted token values at any severity.
 *
 * @param familyId - The Penni family identifier.
 * @returns The new `TokenPair` on success.
 */
export async function refreshTokens(familyId: string): Promise<TokenPair> {
  const conn = getConnection(familyId);
  if (!conn) {
    throw {
      errorType: "no_connection",
      message: `No Yoto connection found for family ${familyId}.`,
    };
  }
  if (!conn.encryptedRefreshToken) {
    throw {
      errorType: "no_refresh_token",
      message: "No refresh token is stored for this connection.",
    };
  }

  const clientId = requireEnv("YOTO_CLIENT_ID");
  const clientSecret = optionalEnv("YOTO_CLIENT_SECRET");
  const authBase = getAuthBase();

  // Decrypt once; never log the value.
  const refreshToken = decryptToken(conn.encryptedRefreshToken);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 5000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;

    try {
      response = await fetch(`${authBase}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (err) {
      // Network-level failure — eligible for retry.
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      // All attempts exhausted.
      upsertConnection({ familyId, status: "needs_attention" });
      throw {
        errorType: "refresh_network_error",
        message:
          "Token refresh failed due to a network error after multiple retries. " +
          "Please reconnect your Yoto account.",
      };
    }

    // 400/401 → revoked or expired token — do NOT retry.
    if (response.status === 400 || response.status === 401) {
      upsertConnection({ familyId, status: "needs_attention" });
      throw {
        errorType: "refresh_token_invalid",
        message:
          "Your Yoto session has expired. Please reconnect your Yoto account.",
      };
    }

    // 5xx → transient server error — retry if attempts remain.
    if (response.status >= 500) {
      lastError = new Error(`HTTP ${response.status}`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      upsertConnection({ familyId, status: "needs_attention" });
      throw {
        errorType: "refresh_server_error",
        message:
          "Token refresh failed due to a server error after multiple retries. " +
          "Please reconnect your Yoto account.",
      };
    }

    if (!response.ok) {
      // Unexpected non-success, non-5xx status — treat as non-retryable.
      upsertConnection({ familyId, status: "needs_attention" });
      throw {
        errorType: "refresh_failed",
        message: `Token refresh failed (HTTP ${response.status}). Please reconnect your Yoto account.`,
      };
    }

    let data: {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    try {
      data = await response.json();
    } catch {
      upsertConnection({ familyId, status: "needs_attention" });
      throw {
        errorType: "refresh_failed",
        message: "Malformed response from Yoto token endpoint.",
      };
    }

    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    const encryptedAccessToken = encryptToken(data.access_token);

    // Atomically write new tokens; retain the old refresh token if not rotated.
    const encryptedRefreshToken = data.refresh_token
      ? encryptToken(data.refresh_token)
      : conn.encryptedRefreshToken;

    upsertConnection({
      familyId,
      encryptedAccessToken,
      encryptedRefreshToken,
      accessTokenExpiresAt: expiresAt,
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt,
    };
  }

  // Unreachable — TypeScript needs a return path.
  throw lastError;
}

// ---------------------------------------------------------------------------
// 5.4 — revokeTokens
// ---------------------------------------------------------------------------

/**
 * Revokes the Yoto access token and removes the family's connection record.
 *
 * Revocation failure is intentionally silent (logged by error type + correlation
 * ID only — never the token value). The local record is always deleted regardless
 * of the Yoto-side outcome, which also invalidates the stored `mediaTokenHash` so
 * subsequent Audio/Icon endpoint requests return 401.
 *
 * @param familyId - The Penni family identifier.
 */
export async function revokeTokens(familyId: string): Promise<void> {
  const conn = getConnection(familyId);

  if (conn?.encryptedAccessToken) {
    const correlationId = generateCorrelationId();

    try {
      const accessToken = decryptToken(conn.encryptedAccessToken);
      const authBase = getAuthBase();

      const body = new URLSearchParams({ token: accessToken });

      const response = await fetch(`${authBase}/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!response.ok) {
        // Log error type and correlation ID only — never the token value.
        console.error("[yoto/oauth] revokeTokens: revocation endpoint returned error", {
          errorType: "revocation_http_error",
          status: response.status,
          correlationId,
        });
      }
    } catch (err) {
      // Network or decryption error — continue with local cleanup regardless.
      console.error("[yoto/oauth] revokeTokens: revocation failed", {
        errorType: err instanceof Error ? err.constructor.name : "unknown_error",
        correlationId,
      });
    }
  }

  // Always remove the local record — this invalidates the mediaTokenHash.
  deleteConnection(familyId);
}

// ---------------------------------------------------------------------------
// 5.5 — ensureFreshToken
// ---------------------------------------------------------------------------

/**
 * Lazily refreshes the access token if it is expired (or within 60 seconds
 * of expiring), then returns the decrypted access token.
 *
 * @param familyId - The Penni family identifier.
 * @returns The decrypted access token string.
 * @throws If no connection record exists, or if the refresh fails.
 */
export async function ensureFreshToken(familyId: string): Promise<string> {
  const conn = getConnection(familyId);
  if (!conn) {
    throw {
      errorType: "no_connection",
      message: `No Yoto connection found for family ${familyId}.`,
    };
  }

  const EXPIRY_BUFFER_MS = 60 * 1000; // 60-second buffer

  const isExpiredOrExpiringSoon =
    !conn.accessTokenExpiresAt ||
    new Date(conn.accessTokenExpiresAt).getTime() - EXPIRY_BUFFER_MS < Date.now();

  if (isExpiredOrExpiringSoon) {
    const pair = await refreshTokens(familyId);
    return pair.accessToken;
  }

  if (!conn.encryptedAccessToken) {
    throw {
      errorType: "no_access_token",
      message: "No access token is stored for this connection.",
    };
  }

  return decryptToken(conn.encryptedAccessToken);
}

// ---------------------------------------------------------------------------
// 5.6 — isPendingFlowExpired
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the pending OAuth flow has passed its 10-minute expiry.
 *
 * Used by the callback route to detect and reject stale flows, satisfying
 * Requirement 1.11.
 *
 * @param conn - The current `YotoConnection` record.
 */
export function isPendingFlowExpired(conn: YotoConnection): boolean {
  if (!conn.oauthExpiresAt) {
    return false;
  }
  return new Date(conn.oauthExpiresAt).getTime() < Date.now();
}
