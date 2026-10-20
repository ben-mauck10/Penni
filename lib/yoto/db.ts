// Connection Store: Turso/libSQL-backed persistence for Yoto integration state.
// Uses @libsql/client (async HTTP) so it works on Vercel serverless.
// Falls back to a local SQLite file when TURSO_DATABASE_URL is not set (dev).

import { createClient, type Client } from "@libsql/client";
import type { YotoConnection } from "./types";

// Guard: this module cannot be used in the Next.js Edge runtime.
if (process.env.NEXT_RUNTIME === "edge") {
  throw new Error(
    "lib/yoto/db.ts cannot be used in the Edge runtime. " +
      "Ensure all routes that import this module are configured for the Node.js runtime."
  );
}

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let client: Client | null = null;

function getClient(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL ?? "file:data/yoto.db";
  const authToken = process.env.TURSO_AUTH_TOKEN;

  client = createClient(authToken ? { url, authToken } : { url });
  return client;
}

// For backwards compatibility — callers that imported getDb() still work.
export function getDb(): Client {
  return getClient();
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS yoto_connections (
  family_id                TEXT PRIMARY KEY NOT NULL,
  yoto_account_id          TEXT,
  status                   TEXT NOT NULL DEFAULT 'not_connected',
  encrypted_access_token   TEXT,
  access_token_expires_at  TEXT,
  encrypted_refresh_token  TEXT,
  playlist_id              TEXT,
  media_token_hash         TEXT,
  balance_mode             TEXT NOT NULL DEFAULT 'hidden',
  oauth_state              TEXT,
  oauth_code_verifier      TEXT,
  oauth_expires_at         TEXT,
  presentation_state_json  TEXT,
  updated_at               TEXT NOT NULL
)
`.trim();

let schemaReady = false;

async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const c = getClient();
  await c.execute(CREATE_TABLE_SQL);
  // Add presentation_state_json column if missing (migration for existing DBs).
  try {
    await c.execute(
      "ALTER TABLE yoto_connections ADD COLUMN presentation_state_json TEXT"
    );
  } catch {
    // Column already exists — ignore.
  }
  schemaReady = true;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

export function rowToConnection(row: Record<string, unknown>): YotoConnection {
  return {
    familyId: row.family_id as string,
    yotoAccountId: (row.yoto_account_id as string | null) ?? null,
    status: row.status as YotoConnection["status"],
    encryptedAccessToken: (row.encrypted_access_token as string | null) ?? null,
    accessTokenExpiresAt: (row.access_token_expires_at as string | null) ?? null,
    encryptedRefreshToken: (row.encrypted_refresh_token as string | null) ?? null,
    playlistId: (row.playlist_id as string | null) ?? null,
    mediaTokenHash: (row.media_token_hash as string | null) ?? null,
    balanceMode: (row.balance_mode as YotoConnection["balanceMode"]) ?? "hidden",
    oauthState: (row.oauth_state as string | null) ?? null,
    oauthCodeVerifier: (row.oauth_code_verifier as string | null) ?? null,
    oauthExpiresAt: (row.oauth_expires_at as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

export async function upsertConnectionAsync(
  conn: Partial<YotoConnection> & { familyId: string }
): Promise<void> {
  await ensureSchema();
  const c = getClient();
  const now = new Date().toISOString();

  const existing = await getConnectionAsync(conn.familyId);

  const merged: YotoConnection = {
    familyId: conn.familyId,
    yotoAccountId: conn.yotoAccountId ?? existing?.yotoAccountId ?? null,
    status: conn.status ?? existing?.status ?? "not_connected",
    encryptedAccessToken: conn.encryptedAccessToken ?? existing?.encryptedAccessToken ?? null,
    accessTokenExpiresAt: conn.accessTokenExpiresAt ?? existing?.accessTokenExpiresAt ?? null,
    encryptedRefreshToken: conn.encryptedRefreshToken ?? existing?.encryptedRefreshToken ?? null,
    playlistId: conn.playlistId ?? existing?.playlistId ?? null,
    mediaTokenHash: conn.mediaTokenHash ?? existing?.mediaTokenHash ?? null,
    balanceMode: conn.balanceMode ?? existing?.balanceMode ?? "hidden",
    oauthState: conn.oauthState ?? existing?.oauthState ?? null,
    oauthCodeVerifier: conn.oauthCodeVerifier ?? existing?.oauthCodeVerifier ?? null,
    oauthExpiresAt: conn.oauthExpiresAt ?? existing?.oauthExpiresAt ?? null,
    updatedAt: now,
  };

  await c.execute({
    sql: `
      INSERT INTO yoto_connections (
        family_id, yoto_account_id, status,
        encrypted_access_token, access_token_expires_at, encrypted_refresh_token,
        playlist_id, media_token_hash, balance_mode,
        oauth_state, oauth_code_verifier, oauth_expires_at, updated_at
      ) VALUES (
        $familyId, $yotoAccountId, $status,
        $encryptedAccessToken, $accessTokenExpiresAt, $encryptedRefreshToken,
        $playlistId, $mediaTokenHash, $balanceMode,
        $oauthState, $oauthCodeVerifier, $oauthExpiresAt, $updatedAt
      )
      ON CONFLICT(family_id) DO UPDATE SET
        yoto_account_id          = excluded.yoto_account_id,
        status                   = excluded.status,
        encrypted_access_token   = excluded.encrypted_access_token,
        access_token_expires_at  = excluded.access_token_expires_at,
        encrypted_refresh_token  = excluded.encrypted_refresh_token,
        playlist_id              = excluded.playlist_id,
        media_token_hash         = excluded.media_token_hash,
        balance_mode             = excluded.balance_mode,
        oauth_state              = excluded.oauth_state,
        oauth_code_verifier      = excluded.oauth_code_verifier,
        oauth_expires_at         = excluded.oauth_expires_at,
        updated_at               = excluded.updated_at
    `,
    args: {
      familyId: merged.familyId,
      yotoAccountId: merged.yotoAccountId,
      status: merged.status,
      encryptedAccessToken: merged.encryptedAccessToken,
      accessTokenExpiresAt: merged.accessTokenExpiresAt,
      encryptedRefreshToken: merged.encryptedRefreshToken,
      playlistId: merged.playlistId,
      mediaTokenHash: merged.mediaTokenHash,
      balanceMode: merged.balanceMode,
      oauthState: merged.oauthState,
      oauthCodeVerifier: merged.oauthCodeVerifier,
      oauthExpiresAt: merged.oauthExpiresAt,
      updatedAt: merged.updatedAt,
    },
  });
}

export async function getConnectionAsync(
  familyId: string
): Promise<YotoConnection | null> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "SELECT * FROM yoto_connections WHERE family_id = $familyId",
    args: { familyId },
  });
  if (result.rows.length === 0) return null;
  return rowToConnection(result.rows[0] as unknown as Record<string, unknown>);
}

export async function deleteConnectionAsync(familyId: string): Promise<void> {
  await ensureSchema();
  await getClient().execute({
    sql: "DELETE FROM yoto_connections WHERE family_id = $familyId",
    args: { familyId },
  });
}

export async function clearPendingOAuthAsync(
  familyId: string,
  status?: YotoConnection["status"]
): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  if (status) {
    await getClient().execute({
      sql: `UPDATE yoto_connections
            SET oauth_state = NULL, oauth_code_verifier = NULL,
                oauth_expires_at = NULL, status = $status, updated_at = $now
            WHERE family_id = $familyId`,
      args: { status, now, familyId },
    });
  } else {
    await getClient().execute({
      sql: `UPDATE yoto_connections
            SET oauth_state = NULL, oauth_code_verifier = NULL,
                oauth_expires_at = NULL, updated_at = $now
            WHERE family_id = $familyId`,
      args: { now, familyId },
    });
  }
}

export async function savePresentationStateAsync(
  familyId: string,
  serializedState: string
): Promise<void> {
  await upsertConnectionAsync({ familyId });
  await getClient().execute({
    sql: `UPDATE yoto_connections
          SET presentation_state_json = $state, updated_at = $now
          WHERE family_id = $familyId`,
    args: { state: serializedState, now: new Date().toISOString(), familyId },
  });
}

export async function getPresentationStateJsonAsync(
  familyId: string
): Promise<string | null> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "SELECT presentation_state_json FROM yoto_connections WHERE family_id = $familyId",
    args: { familyId },
  });
  if (result.rows.length === 0) return null;
  return (result.rows[0].presentation_state_json as string | null) ?? null;
}

export async function getConnectionByMediaTokenHashAsync(
  hash: string
): Promise<YotoConnection | null> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "SELECT * FROM yoto_connections WHERE media_token_hash = $hash",
    args: { hash },
  });
  if (result.rows.length === 0) return null;
  return rowToConnection(result.rows[0] as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Sync shims — kept so existing callers don't all need rewriting at once.
// These throw if called; routes must be updated to use the async versions.
// ---------------------------------------------------------------------------

/** @deprecated Use getConnectionAsync */
export function getConnection(familyId: string): YotoConnection | null {
  throw new Error(
    `getConnection("${familyId}") called synchronously — use getConnectionAsync() instead.`
  );
}

/** @deprecated Use upsertConnectionAsync */
export function upsertConnection(
  _conn: Partial<YotoConnection> & { familyId: string }
): void {
  throw new Error(
    "upsertConnection() called synchronously — use upsertConnectionAsync() instead."
  );
}

/** @deprecated Use deleteConnectionAsync */
export function deleteConnection(_familyId: string): void {
  throw new Error(
    "deleteConnection() called synchronously — use deleteConnectionAsync() instead."
  );
}

/** @deprecated Use clearPendingOAuthAsync */
export function clearPendingOAuth(
  _familyId: string,
  _status?: YotoConnection["status"]
): void {
  throw new Error(
    "clearPendingOAuth() called synchronously — use clearPendingOAuthAsync() instead."
  );
}

/** @deprecated Use savePresentationStateAsync */
export function savePresentationState(
  _familyId: string,
  _serializedState: string
): void {
  throw new Error(
    "savePresentationState() called synchronously — use savePresentationStateAsync() instead."
  );
}

/** @deprecated Use getPresentationStateJsonAsync */
export function getPresentationStateJson(_familyId: string): string | null {
  throw new Error(
    "getPresentationStateJson() called synchronously — use getPresentationStateJsonAsync() instead."
  );
}

// ---------------------------------------------------------------------------
// Family ID helper
// ---------------------------------------------------------------------------

export function getFamilyId(): string {
  const id = process.env.PENNI_FAMILY_ID;
  if (!id) {
    throw new Error(
      "Missing required environment variable PENNI_FAMILY_ID. " +
        "Set it to a stable UUID that identifies this family's Yoto connection record."
    );
  }
  return id;
}
