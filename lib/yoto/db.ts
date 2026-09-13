// Connection Store: SQLite-backed persistence for Yoto integration state.
// Uses better-sqlite3 (synchronous API) — must only run in the Node.js runtime.

import fs from "fs";
import path from "path";
import DatabaseConstructor, { type Database } from "better-sqlite3";
import type { YotoConnection } from "./types";

// Guard: this module cannot be used in the Next.js Edge runtime.
if (process.env.NEXT_RUNTIME === "edge") {
  throw new Error(
    "lib/yoto/db.ts cannot be used in the Edge runtime. " +
      "Ensure all routes that import this module are configured for the Node.js runtime."
  );
}

const DB_PATH = process.env.YOTO_DB_PATH ?? "data/yoto.db";

// Ensure the parent directory exists before opening the database file.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/** Singleton better-sqlite3 instance, lazily initialised on first call to getDb(). */
let db: Database | null = null;

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
);
`.trim();

/**
 * Returns the singleton better-sqlite3 Database instance.
 * Creates the database file and schema on first call.
 */
export function getDb(): Database {
  if (db) return db;

  db = new DatabaseConstructor(DB_PATH);

  // Enable WAL mode for better concurrent read performance.
  db.pragma("journal_mode = WAL");

  // Create table if it does not yet exist.
  db.exec(CREATE_TABLE_SQL);
  ensureColumn("presentation_state_json", "TEXT");

  return db;
}

function ensureColumn(name: string, type: string): void {
  const rows = db!.prepare("PRAGMA table_info(yoto_connections)").all() as {
    name: string;
  }[];
  if (!rows.some((row) => row.name === name)) {
    db!.exec(`ALTER TABLE yoto_connections ADD COLUMN ${name} ${type}`);
  }
}

/**
 * Maps a raw snake_case database row to the camelCase YotoConnection TypeScript type.
 * Used by the CRUD helpers in task 4.2.
 */
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
    balanceMode: row.balance_mode as YotoConnection["balanceMode"],
    oauthState: (row.oauth_state as string | null) ?? null,
    oauthCodeVerifier: (row.oauth_code_verifier as string | null) ?? null,
    oauthExpiresAt: (row.oauth_expires_at as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// CRUD helpers (Task 4.2)
// ---------------------------------------------------------------------------

/**
 * Inserts or updates a connection record for the given family.
 * Always sets updated_at to the current UTC ISO string.
 * Only the fields present in `conn` are written — existing fields are preserved
 * via the ON CONFLICT DO UPDATE clause (only supplied columns are touched).
 */
export function upsertConnection(
  conn: Partial<YotoConnection> & { familyId: string }
): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Build the full row, merging supplied fields over a zero-value default so
  // that INSERT OR REPLACE doesn't wipe columns the caller didn't mention.
  // We first attempt a SELECT to get the existing row (if any).
  const existing = getConnection(conn.familyId);

  const merged: YotoConnection = {
    familyId: conn.familyId,
    yotoAccountId: conn.yotoAccountId ?? existing?.yotoAccountId ?? null,
    status: conn.status ?? existing?.status ?? "not_connected",
    encryptedAccessToken:
      conn.encryptedAccessToken ?? existing?.encryptedAccessToken ?? null,
    accessTokenExpiresAt:
      conn.accessTokenExpiresAt ?? existing?.accessTokenExpiresAt ?? null,
    encryptedRefreshToken:
      conn.encryptedRefreshToken ?? existing?.encryptedRefreshToken ?? null,
    playlistId: conn.playlistId ?? existing?.playlistId ?? null,
    mediaTokenHash: conn.mediaTokenHash ?? existing?.mediaTokenHash ?? null,
    balanceMode: conn.balanceMode ?? existing?.balanceMode ?? "hidden",
    oauthState: conn.oauthState ?? existing?.oauthState ?? null,
    oauthCodeVerifier:
      conn.oauthCodeVerifier ?? existing?.oauthCodeVerifier ?? null,
    oauthExpiresAt: conn.oauthExpiresAt ?? existing?.oauthExpiresAt ?? null,
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO yoto_connections (
      family_id,
      yoto_account_id,
      status,
      encrypted_access_token,
      access_token_expires_at,
      encrypted_refresh_token,
      playlist_id,
      media_token_hash,
      balance_mode,
      oauth_state,
      oauth_code_verifier,
      oauth_expires_at,
      updated_at
    ) VALUES (
      @familyId,
      @yotoAccountId,
      @status,
      @encryptedAccessToken,
      @accessTokenExpiresAt,
      @encryptedRefreshToken,
      @playlistId,
      @mediaTokenHash,
      @balanceMode,
      @oauthState,
      @oauthCodeVerifier,
      @oauthExpiresAt,
      @updatedAt
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
  `).run({
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
  });
}

export function savePresentationState(familyId: string, serializedState: string): void {
  upsertConnection({ familyId });
  getDb()
    .prepare(
      `UPDATE yoto_connections
       SET presentation_state_json = ?, updated_at = ?
       WHERE family_id = ?`
    )
    .run(serializedState, new Date().toISOString(), familyId);
}

export function getPresentationStateJson(familyId: string): string | null {
  const row = getDb()
    .prepare(
      "SELECT presentation_state_json FROM yoto_connections WHERE family_id = ?"
    )
    .get(familyId) as { presentation_state_json: string | null } | undefined;

  return row?.presentation_state_json ?? null;
}

export function clearPendingOAuth(familyId: string, status?: YotoConnection["status"]): void {
  const now = new Date().toISOString();
  if (status) {
    getDb()
      .prepare(
        `UPDATE yoto_connections
         SET oauth_state = NULL,
             oauth_code_verifier = NULL,
             oauth_expires_at = NULL,
             status = ?,
             updated_at = ?
         WHERE family_id = ?`
      )
      .run(status, now, familyId);
    return;
  }

  getDb()
    .prepare(
      `UPDATE yoto_connections
       SET oauth_state = NULL,
           oauth_code_verifier = NULL,
           oauth_expires_at = NULL,
           updated_at = ?
       WHERE family_id = ?`
    )
    .run(now, familyId);
}

/**
 * Returns the connection record for the given familyId, or null if not found.
 */
export function getConnection(familyId: string): YotoConnection | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM yoto_connections WHERE family_id = ?")
    .get(familyId) as Record<string, unknown> | undefined;
  return row ? rowToConnection(row) : null;
}

/**
 * Deletes the connection record for the given familyId.
 * No-op if the record does not exist.
 */
export function deleteConnection(familyId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM yoto_connections WHERE family_id = ?").run(familyId);
}

// ---------------------------------------------------------------------------
// Family ID helper (Task 4.3)
// ---------------------------------------------------------------------------

/**
 * Returns the PENNI_FAMILY_ID environment variable.
 * Throws a clear error at startup if the variable is absent.
 */
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
