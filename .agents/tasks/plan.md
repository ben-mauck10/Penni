# Implementation Plan: Migrate Yoto db callers from sync to async

## Summary of findings

`getConnectionByMediaTokenHashAsync` does NOT yet exist in `lib/yoto/db.ts` — it must be added there first (Step 1). Every other async function already exists. The sync shims (`getConnection`, `upsertConnection`, `deleteConnection`, `clearPendingOAuth`, `savePresentationState`, `getPresentationStateJson`) now throw at runtime; they must be replaced in every caller.

The `deriveStateForFamily` function in `lib/yoto/presentation.ts` currently calls `getConnection` and `getPresentationStateJson` synchronously, so it must be made `async`. The `icon` and `presentation` route files call `deriveStateForFamily`, so they must `await` it once it becomes async.

---

## Step-by-step plan

- [ ] 1. Add `getConnectionByMediaTokenHashAsync` to `lib/yoto/db.ts`
      Add the following export after `getPresentationStateJsonAsync`:
      ```ts
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
      ```
      No other changes to this file.
      Files: `lib/yoto/db.ts`
      Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors on this file.

- [ ] 2. Update `lib/yoto/oauth.ts` — make all four functions async-aware
      This file imports `getConnection`, `upsertConnection`, `deleteConnection` from `./db`.
      Changes:
      - Update the import block: add `getConnectionAsync`, `upsertConnectionAsync`, `deleteConnectionAsync`; remove (or leave unused) the sync names — they will throw at runtime so removing them prevents accidental use.
      - `exchangeCode` (already `async`): replace `upsertConnection({...})` call (line ~179) with `await upsertConnectionAsync({...})`.
      - `refreshTokens` (already `async`): 
        - Replace `const conn = getConnection(familyId)` with `const conn = await getConnectionAsync(familyId)`.
        - Replace every `upsertConnection({...})` call (the four calls handling `needs_attention`, token rotation, etc.) with `await upsertConnectionAsync({...})`.
      - `revokeTokens` (already `async`):
        - Replace `const conn = getConnection(familyId)` with `const conn = await getConnectionAsync(familyId)`.
        - Replace `deleteConnection(familyId)` with `await deleteConnectionAsync(familyId)`.
      - `ensureFreshToken` (already `async`):
        - Replace `const conn = getConnection(familyId)` with `const conn = await getConnectionAsync(familyId)`.
        - The `refreshTokens(familyId)` call is already awaited — no change needed there.
      Files: `lib/yoto/oauth.ts`
      Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors on this file.

- [ ] 3. Update `lib/yoto/playlist.ts` — replace sync db calls
      This file imports `getConnection`, `upsertConnection` from `./db`.
      Changes:
      - Update the import block: replace `getConnection` with `getConnectionAsync`, replace `upsertConnection` with `upsertConnectionAsync`.
      - `createOrUpdatePlaylist` (already `async`):
        - Replace `const conn = getConnection(familyId)` with `const conn = await getConnectionAsync(familyId)`.
        - Replace `upsertConnection({ familyId, status: "playlist_ready", playlistId: cardId })` with `await upsertConnectionAsync({ familyId, status: "playlist_ready", playlistId: cardId })`.
      Files: `lib/yoto/playlist.ts`
      Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 4. Update `lib/yoto/presentation.ts` — make `deriveStateForFamily` async
      This file imports `getConnection`, `getPresentationStateJson` from `./db`.
      Changes:
      - Update the import block: replace `getConnection` with `getConnectionAsync`, replace `getPresentationStateJson` with `getPresentationStateJsonAsync`.
      - Change signature: `export function deriveStateForFamily(...)` → `export async function deriveStateForFamily(...): Promise<YotoPresentationState | null>`.
      - Inside the function body:
        - Replace `getConnection(familyId)?.balanceMode` with `(await getConnectionAsync(familyId))?.balanceMode`.
        - Replace `const serialized = getPresentationStateJson(familyId)` with `const serialized = await getPresentationStateJsonAsync(familyId)`.
      - `deriveState`, `deriveFallbackState`, `serializeState`, `deserializeState` are all sync — no changes needed.
      Files: `lib/yoto/presentation.ts`
      Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 5. Update `app/api/yoto/auth-link/route.ts`
      This file imports `getConnection`, `upsertConnection`, `clearPendingOAuth` from `lib/yoto/db`.
      Changes:
      - Update import block: replace `getConnection` → `getConnectionAsync`, `upsertConnection` → `upsertConnectionAsync`, `clearPendingOAuth` → `clearPendingOAuthAsync`.
      - Inside `GET` handler (already `async`):
        - `const existing = getConnection(familyId)` → `const existing = await getConnectionAsync(familyId)`
        - `clearPendingOAuth(familyId, "not_connected")` → `await clearPendingOAuthAsync(familyId, "not_connected")`
        - `upsertConnection({ familyId, status: "connecting", ... })` → `await upsertConnectionAsync({ familyId, status: "connecting", ... })`
      Keep `export const runtime = "nodejs"`.
      Files: `app/api/yoto/auth-link/route.ts`
      Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 6. Update `app/api/yoto/callback/route.ts`
      This file imports `getConnection`, `clearPendingOAuth` from `lib/yoto/db`, and `exchangeCode` from `lib/yoto/oauth`.
      Changes:
      - Update import block: replace `getConnection` → `getConnectionAsync`, `clearPendingOAuth` → `clearPendingOAuthAsync`.
      - Inside `GET` handler (already `async`):
        - `const conn = getConnection(familyId)` → `const conn = await getConnectionAsync(familyId)`
        - Both `clearPendingOAuth(familyId, "not_connected")` calls → `await clearPendingOAuthAsync(familyId, "not_connected")`
        - `clearPendingOAuth(familyId)` (in the try block on success) → `await clearPendingOAuthAsync(familyId)`
        - The `clearPendingOAuth(familyId, "not_connected")` call in the catch block → `await clearPendingOAuthAsync(familyId, "not_connected")`
      Note: `exchangeCode` is already awaited — no change there.
      Keep `export const runtime = "nodejs"`.
      Files: `app/api/yoto/callback/route.ts`
      Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 7. Update `app/api/yoto/status/route.ts`
      This file imports `getConnection`, `clearPendingOAuth` from `lib/yoto/db`.
      Changes:
      - Update import block: replace `getConnection` → `getConnectionAsync`, `clearPendingOAuth` → `clearPendingOAuthAsync`.
      - Inside `GET` handler (already `async`):
        - `const conn = getConnection(familyId)` → `const conn = await getConnectionAsync(familyId)`
        - `clearPendingOAuth(familyId, "not_connected")` → `await clearPendingOAuthAsync(familyId, "not_connected")`
      Keep `export const runtime = "nodejs"`.
      Files: `app/api/yoto/status/route.ts`
      Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 8. Update `app/api/yoto/connection/route.ts`
      This file imports `getConnection` from `lib/yoto/db`, and `revokeTokens`, `ensureFreshToken` from `lib/yoto/oauth`.
      Changes:
      - Update import block: replace `getConnection` → `getConnectionAsync`.
      - Inside `DELETE` handler (already `async`):
        - `const conn = getConnection(familyId)` → `const conn = await getConnectionAsync(familyId)`
      Note: `ensureFreshToken` and `revokeTokens` are already awaited — no change there.
      Keep `export const runtime = "nodejs"`.
      Files: `app/api/yoto/connection/route.ts`
      Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 9. Update `app/api/yoto/playlist/route.ts`
      This file imports `getConnection` from `lib/yoto/db`.
      Changes:
      - Update import block: replace `getConnection` → `getConnectionAsync`.
      - Inside `POST` handler (already `async`):
        - `const conn = getConnection(familyId)` → `const conn = await getConnectionAsync(familyId)`
      Keep `export const runtime = "nodejs"`.
      Files: `app/api/yoto/playlist/route.ts`
      Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 10. Update `app/api/yoto/balance-mode/route.ts`
       This file imports `getConnection`, `upsertConnection` from `lib/yoto/db` and `deriveStateForFamily` from `lib/yoto/presentation`.
       Changes:
       - Update import block: replace `getConnection` → `getConnectionAsync`, `upsertConnection` → `upsertConnectionAsync`.
       - Inside `PUT` handler (already `async`):
         - `upsertConnection({ familyId, balanceMode: ... })` → `await upsertConnectionAsync({ familyId, balanceMode: ... })`
         - `const conn = getConnection(familyId)` → `const conn = await getConnectionAsync(familyId)`
         - `deriveStateForFamily(familyId)` → `await deriveStateForFamily(familyId)` (function is now async after Step 4)
       Keep `export const runtime = "nodejs"`.
       Files: `app/api/yoto/balance-mode/route.ts`
       Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 11. Update `app/api/yoto/presentation/route.ts`
       This file imports `getConnection`, `savePresentationState` from `lib/yoto/db` and `deriveStateForFamily` is NOT imported here (it imports `deriveState` from presentation.ts, not `deriveStateForFamily`).
       Changes:
       - Update import block: replace `getConnection` → `getConnectionAsync`, replace `savePresentationState` → `savePresentationStateAsync`.
       - Inside `PUT` handler (already `async`):
         - `const balanceMode = getConnection(familyId)?.balanceMode` → `const balanceMode = (await getConnectionAsync(familyId))?.balanceMode`
         - `savePresentationState(familyId, serializeState(state))` → `await savePresentationStateAsync(familyId, serializeState(state))`
       Keep `export const runtime = "nodejs"`.
       Files: `app/api/yoto/presentation/route.ts`
       Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 12. Update `app/api/yoto/debug-card/route.ts`
       This file imports `getConnection` from `lib/yoto/db`.
       Changes:
       - Update import block: replace `getConnection` → `getConnectionAsync`.
       - Inside `GET` handler (already `async`):
         - `const conn = getConnection(familyId)` → `const conn = await getConnectionAsync(familyId)`
       Note: `ensureFreshToken(familyId)` is already awaited — no change.
       Keep `export const runtime = "nodejs"`.
       Files: `app/api/yoto/debug-card/route.ts`
       Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 13. Update `app/api/yoto/audio/[token]/[chapter]/route.ts`
       This file currently uses `getDb()` to run a raw `.prepare(...).get(hash)` better-sqlite3 call.
       Changes:
       - Remove import of `getDb` from `lib/yoto/db`.
       - Add import of `getConnectionByMediaTokenHashAsync` from `lib/yoto/db`.
       - Inside `GET` handler (already `async`):
         - Remove the `const db = getDb()` line.
         - Remove the `const row = db.prepare(...).get(hash)` line.
         - Replace both with: `const conn = await getConnectionByMediaTokenHashAsync(hash)`
         - Replace `const validMediaToken = row !== undefined || verifySignedMediaToken(token) !== null` with `const validMediaToken = conn !== null || verifySignedMediaToken(token) !== null`
       Note: the audio route does not need `familyId` or the full connection object — `validMediaToken` is all that's used. No other logic changes.
       Keep `export const runtime = "nodejs"`.
       Files: `app/api/yoto/audio/[token]/[chapter]/route.ts`
       Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 14. Update `app/api/yoto/icon/[token]/route.ts`
       This file currently uses `getDb()` + `rowToConnection` for a raw better-sqlite3 query, then calls `deriveStateForFamily` (which is now async after Step 4).
       Changes:
       - Remove imports of `getDb` and `rowToConnection` from `lib/yoto/db`.
       - Add import of `getConnectionByMediaTokenHashAsync` from `lib/yoto/db`.
       - Inside `GET` handler (already `async`):
         - Remove the `const db = getDb()` line.
         - Remove the `const row = db.prepare(...).get(hash)` line.
         - Replace both with: `const conn = await getConnectionByMediaTokenHashAsync(hash)`
         - Replace the `familyId` derivation:
           ```ts
           // Before:
           const familyId = row
             ? rowToConnection(row).familyId
             : verifySignedMediaToken(token);
           // After:
           const familyId = conn
             ? conn.familyId
             : verifySignedMediaToken(token);
           ```
         - `deriveStateForFamily` is now async (Step 4): replace `const state = deriveStateForFamily(familyId)` with `const state = await deriveStateForFamily(familyId)`
       Keep `export const runtime = "nodejs"`.
       Files: `app/api/yoto/icon/[token]/route.ts`
       Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — no errors.

- [ ] 15. Final full build check
       Run the TypeScript compiler across the entire project to confirm no remaining sync db call sites were missed.
       Verify: `cd /Users/leahmauck/Documents/penny-pig-app && npx tsc --noEmit` — zero errors.
       Also verify no leftover calls to the deprecated sync functions:
       `grep -rn "getConnection\b\|upsertConnection\b\|deleteConnection\b\|clearPendingOAuth\b\|savePresentationState\b\|getPresentationStateJson\b\|getDb()" app/api/yoto lib/yoto --include="*.ts" | grep -v "Async\b" | grep -v "db.ts"` — should return no matches (only the shim definitions in db.ts are expected to remain).

---

## Dependency order

Steps 1–4 must complete before Steps 5–14, because the route files depend on the updated lib exports. Within Steps 5–14 there are no cross-dependencies — they can be done in any order, but sequential is fine. Step 15 runs last.

| Step | Depends on |
|------|-----------|
| 1 | — |
| 2 | 1 |
| 3 | 1 |
| 4 | 1 |
| 5–14 | 1, 2, 3, 4 |
| 15 | 5–14 |
