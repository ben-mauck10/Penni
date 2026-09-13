# Implementation Plan: Yoto Integration

## Overview

Implement the optional Yoto integration for the Penni Pig parent app. The plan is ordered by dependency: shared foundation first (types, crypto, DB), then services (OAuth, presentation, playlist, TTS, icon), then API routes, then the settings UI, then tests. Every task references the requirements and design sections it satisfies.

---

## Tasks

- [x] 1. Install dependencies and set up test runner
  - Add `better-sqlite3`, `@types/better-sqlite3`, `pngjs`, `@types/pngjs` to `dependencies`
  - Add `vitest`, `@vitest/coverage-v8`, `fast-check` to `devDependencies`
  - Add `"test": "vitest --run"` and `"test:coverage": "vitest --run --coverage"` scripts to `package.json`
  - Create `vitest.config.ts` at workspace root configured for the Next.js TypeScript project
  - _Requirements: Design §Testing Strategy_

- [x] 2. Define shared Yoto types (`lib/yoto/types.ts`)
  - [x] 2.1 Create `lib/yoto/types.ts` with `BalanceMode`, `ConnectionStatus`, `YotoConnection`, and `YotoPresentationState` types exactly as specified in the design's Data Models section
    - Include all fields: `childDisplayName`, `balanceMode`, `availableAmountPence`, `goalName`, `goalProgressPercent`, `weeklyChangePence`, `activityPromptId`, `generatedAt`
    - `YotoConnection` must include all OAuth PKCE temp fields and the `mediaTokenHash` field
    - _Requirements: 4.6, 8.1, 12.1_

- [x] 3. Implement crypto utilities (`lib/yoto/crypto.ts`)
  - [x] 3.1 Implement `generateSecureToken(bytes?: number): string` using `crypto.randomBytes`, returning base64url output; default 32 bytes (256 bits)
    - _Requirements: 1.4, 10.1_
  - [x] 3.2 Implement `hashToken(token: string): string` returning a SHA-256 hex digest using Node.js built-in `crypto`
    - _Requirements: 10.2, 10.3_
  - [x] 3.3 Implement `encryptToken(plaintext: string): string` using AES-256-GCM with a unique 12-byte IV per call; key sourced from `YOTO_ENCRYPTION_KEY` env var (32-byte hex); stored format `${iv_hex}:${ciphertext_base64url}:${authTag_hex}`
    - _Requirements: 1.8_
  - [x] 3.4 Implement `decryptToken(ciphertext: string): string` that parses the stored format, verifies the GCM auth tag, and throws on any mismatch
    - _Requirements: 1.8_
  - [x] 3.5 Implement `buildPkceParams(): { codeVerifier: string; codeChallenge: string }` that generates a URL-safe `codeVerifier` between 43 and 128 characters and derives `codeChallenge` as its SHA-256 base64url hash (RFC 7636 S256 method)
    - _Requirements: 1.4, 1.6_
  - [x]* 3.6 Write property tests for crypto utilities (`lib/yoto/__tests__/crypto.pbt.ts`)
    - **Property 7: PKCE state parameter has sufficient entropy** — assert `generateSecureToken(16)` output encodes ≥16 raw bytes
    - **Property 8: PKCE code_verifier length is within RFC 7636 bounds** — assert `buildPkceParams().codeVerifier` length is in [43, 128]
    - **Property 9: Encrypt then decrypt is identity** — for any non-empty string, `decryptToken(encryptToken(s)) === s`
    - **Validates: Requirements 1.4, 1.6, 1.8**

- [x] 4. Implement Connection Store (`lib/yoto/db.ts`)
  - [x] 4.1 Create `lib/yoto/db.ts` that opens (or creates) the SQLite database at `YOTO_DB_PATH` (default `data/yoto.db`) using `better-sqlite3` and creates the `yoto_connections` table with all columns defined in the design's schema
    - Export a `getDb()` function that returns the singleton `better-sqlite3` instance; guard against Edge runtime by checking `process.env.NEXT_RUNTIME`
    - _Requirements: Design §SQLite Database Schema_
  - [x] 4.2 Implement CRUD helpers: `upsertConnection(conn: Partial<YotoConnection>): void`, `getConnection(familyId: string): YotoConnection | null`, `deleteConnection(familyId: string): void`
    - `upsertConnection` must set `updated_at` to the current UTC ISO string on every write
    - _Requirements: 1.8, 2.2, 9.3_
  - [x] 4.3 Implement `getFamilyId(): string` that reads `PENNI_FAMILY_ID` env var and throws a clear startup error if absent
    - _Requirements: Design §Family ID strategy_

- [x] 5. Implement OAuth Service (`lib/yoto/oauth.ts`)
  - [x] 5.1 Implement `buildAuthUrl(origin: string): { url: string; state: string; codeVerifier: string }` that generates state (≥128 bits), calls `buildPkceParams()`, and builds the Yoto authorization URL with scopes `user:content:manage offline_access` only (no `family:devices:control`)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 5.2 Implement `exchangeCode(code: string, codeVerifier: string, origin: string): Promise<TokenPair>` that POSTs to the Yoto token endpoint, encrypts returned tokens via `crypto.ts`, and writes them to the Connection Store; throws a structured error if the exchange fails
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9_
  - [x] 5.3 Implement `refreshTokens(familyId: string): Promise<TokenPair>` that decrypts the stored refresh token, POSTs to Yoto's token endpoint, atomically writes new tokens (retaining old refresh token if not rotated), retries on 5xx/network up to 3 times with ≥5 s interval, and sets `needs_attention` on 400/401 or after exhausting retries
    - Must not log decrypted token values at any log level
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [x] 5.4 Implement `revokeTokens(familyId: string): Promise<void>` that calls the Yoto token revocation endpoint and deletes the connection record regardless of revocation outcome; invalidates the media token hash so subsequent endpoint requests receive 401
    - _Requirements: 9.1, 9.2, 9.3, 9.6_
  - [x] 5.5 Implement `ensureFreshToken(familyId: string): Promise<string>` — a lazy helper that checks `access_token_expires_at` and calls `refreshTokens` if the stored token is expired; returns the decrypted access token
    - _Requirements: 2.1_
  - [-] 5.6 Implement the 10-minute OAuth flow expiry check: export `isPendingFlowExpired(conn: YotoConnection): boolean` that compares `oauthExpiresAt` to `Date.now()`; call this in the callback route to invalidate stale flows
    - _Requirements: 1.11_

- [x] 6. Implement Presentation Service (`lib/yoto/presentation.ts`)
  - [x] 6.1 Implement `deriveState(plan: PenniPlan, balanceMode: BalanceMode, opts?: { childDisplayName?: string }): YotoPresentationState` that derives `YotoPresentationState` exclusively from `PenniPlan` pot values, save goal progress, and `weeklyChangePence` (pass-through); never reads raw TrueLayer data
    - Set `availableAmountPence` only when `balanceMode !== "hidden"`; round to nearest 100 pence when `"rounded"`
    - Cap `goalProgressPercent` at 100
    - Set `activityPromptId` to `"default"` when data is available
    - Set `generatedAt` to current UTC ISO string
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [~] 6.2 Implement `deriveStateForFamily(familyId: string): YotoPresentationState | null` that reads `PenniPlan` from the server-side storage path and the family's `balanceMode` from the Connection Store; returns `null` if plan is unavailable, setting `activityPromptId` to `"fallback"` when returning a bare fallback object
    - _Requirements: 4.9_
  - [x] 6.3 Implement `serializeState(state: YotoPresentationState): string` (JSON.stringify wrapper) and `deserializeState(json: string): YotoPresentationState | { errorType: string; message: string }` with full schema validation; return a structured error — never a partial object — on invalid input
    - _Requirements: 12.1, 12.2, 12.3_
  - [ ]* 6.4 Write property tests for Presentation Service (`lib/yoto/__tests__/presentation.pbt.ts`)
    - **Property 1: YotoPresentationState serialisation round-trip** — for any valid state, `deserializeState(serializeState(state))` produces identical field values
    - **Property 2: Invalid JSON deserialisation produces a structured error** — for any non-conforming string, result has `errorType` and `message` and is NOT a partial state
    - **Property 3: hidden balance mode never exposes an amount** — for any plan derived with `balanceMode: "hidden"`, `availableAmountPence` is absent
    - **Property 4: rounded amounts are rounded to the nearest 100 pence** — for any plan with `balanceMode: "rounded"`, `availableAmountPence % 100 === 0`
    - **Property 10: goalProgressPercent is always capped at 100** — for any plan where allocated ≥ target, `goalProgressPercent === 100`
    - **Validates: Requirements 4.1–4.6, 12.1–12.4**

- [x] 7. Implement Icon Generator (`lib/yoto/icon.ts`)
  - [x] 7.1 Implement `generateIcon(goalProgressPercent: number | undefined): Buffer` using `pngjs` to produce a 16×16 32-bit RGBA PNG
    - Filled rows from bottom = `Math.round((goalProgressPercent ?? 100) / 100 * 16)`; filled colour `#4ade80` (fully opaque); unfilled colour `#1f2937` (fully opaque)
    - When `goalProgressPercent` is `undefined`, return the static full-fill icon (all 16 rows filled)
    - _Requirements: 6.2, 6.4, 6.5_
  - [ ]* 7.2 Write property tests for Icon Generator (`lib/yoto/__tests__/icon.pbt.ts`)
    - **Property 5: Icon fill rows match goal progress** — for any integer in [0, 100], decode the returned PNG with `pngjs` and assert filled row count from the bottom equals `Math.round(p / 100 * 16)` within ±1
    - **Validates: Requirements 6.4**

- [x] 8. Implement TTS Adapter (`lib/yoto/tts.ts`)
  - [x] 8.1 Define the `TTSAdapter` interface: `synthesize(script: string): Promise<Buffer>`
    - _Requirements: 5.2, 5.3_
  - [~] 8.2 Implement `ElevenLabsAdapter` that POSTs to `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}` with `output_format: mp3_44100_64`, reads `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` env vars, and returns the response body as a `Buffer`
    - _Requirements: 5.2, Design §TTS Adapter_
  - [~] 8.3 Implement `ScriptedFallbackAdapter` that reads and returns the pre-recorded asset at `public/yoto/fallback.mp3`; if the file is absent, throw a descriptive error (caller handles as 503)
    - _Requirements: 5.6, 14.4_
  - [~] 8.4 Implement `getScriptForChapter(chapter: "update" | "changed" | "moment", state: YotoPresentationState): string` that generates the appropriate spoken script per chapter, respecting `balanceMode` (never includes a currency value when `hidden`; expresses as "about £X" when `rounded`; as "£X.XX" when `exact`)
    - Chapter 2: use `weeklyChangePence`; if zero, state that the amount is unchanged; never reference individual transactions
    - Chapter 3: no script needed (static asset)
    - _Requirements: 5.3, 5.4, 5.5, 7.5, 7.6, 7.7_
  - [~] 8.5 Implement `getTTSAdapter(): TTSAdapter` factory that reads `TTS_PROVIDER` env var; returns `ElevenLabsAdapter` when set to `"elevenlabs"` and `ELEVENLABS_API_KEY` is present; otherwise returns `ScriptedFallbackAdapter`
    - _Requirements: Design §TTS Adapter_

- [ ] 9. Implement Playlist Service (`lib/yoto/playlist.ts`)
  - [~] 9.1 Implement `buildPlaylistPayload(origin: string, mediaToken: string): object` that constructs the Yoto card/playlist payload with exactly three chapters (`01-update`, `02-changed`, `03-moment`), setting `url` to the Audio Endpoint and `display.icon16x16` to the Icon Endpoint using the opaque `mediaToken` — no family IDs, child names, or PII in URLs
    - Chapters 1 and 2: `type: "stream"`, `format: "mp3"`, pointing to Audio Endpoint
    - Chapter 3: static MP3 URL pointing to `public/yoto/moment.mp3` served by Next.js
    - _Requirements: 3.2, 3.3, 3.4, 3.5_
  - [~] 9.2 Implement `createOrUpdatePlaylist(familyId: string, origin: string): Promise<{ playlistId: string }>` that calls `ensureFreshToken`, then either POSTs to create (if no `playlistId` in Connection Store) or PUTs to update (if one exists); stores returned content ID in Connection Store; does not overwrite an existing content ID on error
    - Implements the retry-with-exponential-back-off queue for connectivity loss (initial 1 s, max 30 s, max 3 attempts)
    - _Requirements: 3.1, 3.6, 3.7, 3.8, 3.9, 14.5_

- [ ] 10. Implement OAuth API routes
  - [~] 10.1 Create `app/api/yoto/auth-link/route.ts` (GET handler) that calls `buildAuthUrl`, stores `state` and `codeVerifier` in an `httpOnly` session cookie with 10-minute `maxAge`, and redirects to the Yoto authorization URL — mirror the pattern in `app/api/auth-link/route.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.9_
  - [~] 10.2 Create `app/api/yoto/callback/route.ts` (GET handler) that validates the `state` query param against the cookie, validates `error` param, checks for flow expiry via `isPendingFlowExpired`, calls `exchangeCode`, clears PKCE cookie, and redirects to `/settings?yoto=connected` on success or `/settings?yoto=error&reason={reason}` on failure
    - _Requirements: 1.5, 1.6, 1.7, 1.10, 1.11_
  - [~] 10.3 Create `app/api/yoto/status/route.ts` (GET handler) that reads the family's connection record and returns `{ status, yotoAccountId, balanceMode, playlistId }` — no token values in the response
    - _Requirements: 1.10, 8.1–8.7_
  - [~] 10.4 Create `app/api/yoto/playlist/route.ts` (POST handler) that calls `createOrUpdatePlaylist` and returns `{ playlistId }` on success or a user-facing error; validates that connection status is `connected` or `connected_no_playlist` before proceeding
    - _Requirements: 3.1, 3.6, 3.7, 3.8, 3.9_
  - [~] 10.5 Create `app/api/yoto/balance-mode/route.ts` (PUT handler) that validates the `{ balanceMode }` body against the enum, persists it to the Connection Store, and triggers `deriveStateForFamily` to refresh the presentation state if a playlist exists
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [~] 10.6 Create `app/api/yoto/connection/route.ts` (DELETE handler) that accepts an optional `{ deletePlaylist: boolean }` body; revokes tokens via `revokeTokens`; optionally calls the Yoto API to delete the card; deletes the local connection record regardless; sets status to `not_connected`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [ ] 11. Implement Audio Endpoint (`app/api/yoto/audio/[token]/[chapter]/route.ts`)
  - [~] 11.1 Create the route file with a GET handler that extracts `token` and `chapter` from the dynamic path segments
    - Hash the provided `token` and compare to `mediaTokenHash` in the Connection Store; return HTTP 401 without distinguishing missing vs. invalid if the hashes do not match (do NOT log the token value)
    - Validate `chapter` against known keys (`update`, `changed`, `moment`); return HTTP 404 for unknown chapters
    - _Requirements: 5.1, 5.7, 5.8, 10.3, 10.4, 10.7, 11.1, 11.3, 11.4_
  - [~] 11.2 Wire chapter response logic:
    - Chapters 1 (`update`) and 2 (`changed`): call `deriveStateForFamily`; if `null`, return HTTP 503; otherwise call `getScriptForChapter` and `getTTSAdapter().synthesize(script)`; return the MP3 buffer with `Content-Type: audio/mpeg` and `Cache-Control: private, no-store`
    - Chapter 3 (`moment`): serve the static `public/yoto/moment.mp3` asset; if file missing, return HTTP 503
    - On TTS synthesis failure: serve `public/yoto/fallback.mp3` and log error type + correlation ID only
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.9, 5.11, 5.12, 14.3, 14.4_

- [ ] 12. Implement Icon Endpoint (`app/api/yoto/icon/[token]/route.ts`)
  - [~] 12.1 Create the route file with a GET handler that extracts `token` from the dynamic path segment
    - Hash the provided `token` and compare to `mediaTokenHash`; return HTTP 401 on mismatch (do NOT log the token value)
    - Call `deriveStateForFamily`; if `null`, return HTTP 503
    - Call `generateIcon(state.goalProgressPercent)` and return the buffer with `Content-Type: image/png` and `Cache-Control: private, no-store`
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.7, 6.8, 10.3, 10.4, 11.2_

- [ ] 13. Add static fallback and chapter 3 audio assets
  - [~] 13.1 Add a placeholder `public/yoto/moment.mp3` (a minimal valid silent MP3) and `public/yoto/fallback.mp3` so routes do not 503 before real assets are produced; document in a `public/yoto/README.md` that these should be replaced with real recordings before production
    - _Requirements: 5.6, 5.12, 14.3_

- [~] 14. Checkpoint — core services and routes
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Implement Yoto Settings UI (`app/yoto/settings/page.tsx`)
  - [~] 15.1 Create `app/yoto/settings/page.tsx` as a client component (`"use client"`) that fetches `/api/yoto/status` on mount and renders exactly one of the six connection state panels based on `ConnectionStatus`
    - `not_connected` → "Connect Yoto" button (links to `/api/yoto/auth-link`)
    - `connecting` → progress indicator, all other actions suppressed
    - `connected_no_playlist` → "Create Penni playlist" button
    - `playlist_ready` → MYO card linking instructions + "Preview" action
    - `ready` → balance mode selector, "Test / regenerate" action, "Disconnect" action
    - `needs_attention` → descriptive message + "Reconnect" action
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [~] 15.2 Wire up all action handlers:
    - "Create Penni playlist" → POST `/api/yoto/playlist`, then re-fetch status
    - Balance mode save → PUT `/api/yoto/balance-mode`, re-fetch status
    - "Disconnect" → prompt for optional playlist deletion, then DELETE `/api/yoto/connection`, re-fetch status
    - Display persistent user-facing error messages for all API errors without exposing raw error bodies, tokens, or internal identifiers; error messages remain visible until the parent dismisses them or a subsequent operation supersedes them
    - _Requirements: 3.7, 7.1, 7.2, 8.8, 9.4, 9.5_
  - [~] 15.3 Add a "Yoto" link or section to the existing `app/settings/page.tsx` (or navigation) pointing to `/yoto/settings` so parents can discover and reach the Yoto panel
    - _Requirements: 1.1_

- [~] 16. Final checkpoint — full integration
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Checkpoints ensure incremental validation.
- Property tests validate universal correctness properties; unit tests validate specific examples and edge cases.
- The `public/yoto/moment.mp3` and `public/yoto/fallback.mp3` placeholder assets (task 13.1) must be replaced with real recordings before production.
- Run tests with `npm run test` (single-pass via `vitest --run`); never run `npm run dev` or the vitest watcher.
- All Yoto token values must never appear in logs at any severity level (Requirements 2.6, 10.7, 13.1).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1"] },
    { "id": 1, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "4.1"] },
    { "id": 2, "tasks": ["3.6", "4.2", "4.3"] },
    { "id": 3, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "6.1", "6.2", "6.3", "7.1", "8.1"] },
    { "id": 4, "tasks": ["6.4", "7.2", "8.2", "8.3", "8.4", "8.5", "9.1"] },
    { "id": 5, "tasks": ["9.2"] },
    { "id": 6, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5", "10.6", "13.1"] },
    { "id": 7, "tasks": ["11.1", "11.2", "12.1"] },
    { "id": 8, "tasks": ["15.1", "15.2", "15.3"] }
  ]
}
```
