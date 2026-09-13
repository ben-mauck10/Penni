# Requirements Document

## Introduction

This feature adds an optional Yoto integration to the Penni Pig parent app. A parent connects their Yoto account, and Penni creates a "Penni Pig" MYO (Make Your Own) playlist in the parent's Yoto library. When a child inserts the linked physical MYO card into a Yoto Player, the card plays a short, child-friendly Penni experience — a spoken update on their savings progress, a summary of recent changes, and a family money prompt — using audio and the Yoto player's 16×16 display.

Penni remains the financial system of record. TrueLayer tokens and raw banking data never leave the Penni backend. The Yoto service receives only a derived, child-safe presentation state. Exact balance amounts are opt-in; the default is progress-based.

---

## Glossary

- **Penni_App**: The Next.js Penni Pig application, server and client combined.
- **Yoto_Service**: The external Yoto platform, including its OAuth server, content API, and physical Yoto Players.
- **OAuth_Service**: The Penni-side module that manages the Yoto authorization-code + PKCE flow and secure token storage.
- **Connection_Store**: The server-side encrypted storage (database table `yoto_connections`) that maps a Penni family to a Yoto account, playlist, and media access token.
- **Presentation_Service**: The Penni module that derives a `YotoPresentationState` from internal financial state.
- **YotoPresentationState**: A minimal, child-safe data object used to generate audio scripts and display icons. Contains no raw bank data.
- **Audio_Endpoint**: The Penni API route that returns a dynamically generated MP3 for a named playlist chapter.
- **Icon_Endpoint**: The Penni API route that returns a valid 16×16 32-bit RGBA PNG representing the current Penni state.
- **MYO_Card**: A physical Yoto Make Your Own card linked to a playlist by the parent using the Yoto app.
- **Penni_Playlist**: The single Yoto content item created by Penni in the parent's Yoto library, containing three chapters.
- **Media_Access_Token**: A high-entropy opaque identifier stored server-side that Yoto uses to authenticate requests to the Audio_Endpoint and Icon_Endpoint.
- **Balance_Mode**: A parent-controlled setting that governs whether the child hears the exact amount, a rounded amount, or no amount at all. Values: `hidden`, `rounded`, `exact`.
- **Chapter**: One track within the Penni_Playlist. The MVP has three chapters: "My Penni update", "What changed?", and "Family money moment".
- **Family**: A single Penni account unit; one family maps to at most one Yoto connection.

---

## Requirements

### Requirement 1: Yoto Account Connection

**User Story:** As a parent, I want to connect my Yoto account to Penni, so that Penni can create a playlist in my Yoto library for my child's MYO card.

#### Acceptance Criteria

1. THE Penni_App SHALL expose a "Connect Yoto" action in the settings/connection UI.
2. WHEN a parent initiates "Connect Yoto", THE OAuth_Service SHALL begin an authorization-code flow with PKCE and the minimum required scopes (`user:content:manage` and `offline_access`).
3. THE OAuth_Service SHALL NOT request the `family:devices:control` scope during the authorization flow.
4. WHEN a parent initiates "Connect Yoto", THE OAuth_Service SHALL generate a cryptographically random `state` parameter with at least 128 bits of entropy and a PKCE `code_verifier` between 43 and 128 characters long for each authorization request.
5. WHEN the Yoto OAuth callback is received, THE OAuth_Service SHALL validate that the returned `state` parameter matches the value generated in criterion 4 before proceeding.
6. WHEN the Yoto OAuth callback is received, THE OAuth_Service SHALL validate the PKCE `code_challenge` against the stored `code_verifier` before exchanging the authorization code for tokens.
7. IF the `state` or PKCE validation in criteria 5 or 6 fails, THEN THE OAuth_Service SHALL reject the callback with an error and SHALL NOT store any tokens, and THE Penni_App SHALL display a user-facing error message indicating that the connection attempt failed.
8. WHEN the authorization code is successfully exchanged, THE OAuth_Service SHALL encrypt the access token and refresh token before writing them to the Connection_Store.
9. THE OAuth_Service SHALL NOT expose Yoto access tokens or refresh tokens in browser local storage, session storage, or client-visible cookies.
10. IF a Yoto connection already exists for a family, THEN THE Penni_App SHALL display the connected Yoto account identifier and the current connection status (`connected` or `needs_attention`) rather than starting a new OAuth flow.
11. IF a pending OAuth flow has not been completed within 10 minutes of initiation, THEN THE OAuth_Service SHALL invalidate the stored `state` and `code_verifier`, and THE Penni_App SHALL display a user-visible message indicating that the connection attempt has expired.

---

### Requirement 2: Secure Token Refresh and Rotation

**User Story:** As a parent, I want my Yoto connection to stay active without me re-authenticating, so that my child's card keeps working after the access token expires.

#### Acceptance Criteria

1. WHILE a valid encrypted refresh token exists in the Connection_Store, WHEN the stored access token expiry timestamp is in the past, THE OAuth_Service SHALL use the refresh token to obtain a new access token from the Yoto API.
2. WHEN the Yoto API returns a new refresh token during a token refresh, THE OAuth_Service SHALL atomically replace the old refresh token in the Connection_Store with the new one in a single write operation, ensuring no state where neither token is present.
3. IF the Yoto API does not return a new refresh token during a token refresh, THEN THE OAuth_Service SHALL retain the existing refresh token in the Connection_Store unchanged.
4. IF a token refresh fails because the Yoto API indicates the refresh token is revoked or expired, THEN THE OAuth_Service SHALL update the connection status to `needs_attention` in the Connection_Store and SHALL NOT retry with the same token.
5. IF a token refresh fails due to a transient error (network timeout or 5xx response), THEN THE OAuth_Service SHALL retry up to 3 times with an interval of at least 5 seconds between attempts before updating the connection status to `needs_attention`.
6. THE OAuth_Service SHALL NOT log Yoto access tokens, refresh tokens, or their decrypted values at any log level.

---

### Requirement 3: Yoto Playlist Creation

**User Story:** As a parent, I want Penni to create a "Penni Pig" playlist in my Yoto library, so that I can link it to a physical MYO card.

#### Acceptance Criteria

1. WHEN a parent requests playlist creation and a Yoto connection exists with status `connected`, THE Penni_App SHALL call the Yoto content API to create a new playlist named "Penni Pig" and store the returned content ID in the Connection_Store.
2. WHEN Penni creates the playlist, THE Penni_App SHALL populate it with exactly three chapters in order: "My Penni update", "What changed?", and "Family money moment".
3. WHEN Penni creates the playlist, THE Penni_App SHALL configure chapters 1 and 2 with `type: "stream"`, `format: "mp3"`, and a `trackUrl` pointing to the Audio_Endpoint using the family's Media_Access_Token.
4. WHEN Penni creates the playlist, THE Penni_App SHALL configure each chapter's display icon with a URL pointing to the Icon_Endpoint using the family's Media_Access_Token.
5. THE Audio_Endpoint and Icon_Endpoint URLs embedded in the playlist SHALL use an opaque identifier with at least 128 bits of randomness and SHALL NOT include family IDs, child names, or any personally identifiable information.
6. IF a playlist already exists for the family (a content ID is stored in the Connection_Store), THEN THE Penni_App SHALL update the existing playlist rather than creating a duplicate, and the existing content ID SHALL NOT be overwritten during an update.
7. WHEN playlist creation or update succeeds, THE Penni_App SHALL display instructions guiding the parent to open the Yoto app and link the playlist to a blank MYO card.
8. IF the Yoto API returns an error during playlist creation or update, THEN THE Penni_App SHALL display a user-facing error message and SHALL NOT modify the existing content ID in the Connection_Store.
9. IF a parent requests playlist creation and no Yoto connection exists or the connection status is not `connected`, THEN THE Penni_App SHALL display an error indicating that a Yoto connection is required before creating a playlist.

---

### Requirement 4: Child-Safe Presentation State

**User Story:** As a parent, I want Penni to derive a child-safe summary of our financial state, so that no sensitive bank data is ever sent to Yoto.

#### Acceptance Criteria

1. THE Presentation_Service SHALL derive a `YotoPresentationState` object exclusively from the Penni plan's pot values, save goal progress, and weekly change delta — never from raw TrueLayer responses, account numbers, transaction descriptions, or merchant data.
2. IF the family's `Balance_Mode` is `exact` or `rounded`, THEN THE Presentation_Service SHALL include `availableAmountPence` in the `YotoPresentationState`.
3. WHEN `Balance_Mode` is `rounded`, THE Presentation_Service SHALL round `availableAmountPence` to the nearest 100 pence before including it in the `YotoPresentationState`.
4. IF `Balance_Mode` is `hidden`, THEN THE Presentation_Service SHALL omit `availableAmountPence` from the `YotoPresentationState`.
5. THE Presentation_Service SHALL set `Balance_Mode` to `hidden` by default for all new connections.
6. THE `YotoPresentationState` SHALL contain the fields: `childDisplayName` (optional string), `balanceMode` (required, one of `hidden`, `rounded`, `exact`), `availableAmountPence` (conditional integer), `goalName` (optional string), `goalProgressPercent` (optional integer 0–100, capped at 100), `weeklyChangePence` (optional integer, positive for net saving, negative for net spending), `activityPromptId` (required string), and `generatedAt` (required ISO 8601 UTC string).
7. THE Presentation_Service SHALL NOT include bank names, account numbers, transaction descriptions, merchant data, TrueLayer tokens, or parental balances in the `YotoPresentationState`.
8. WHEN generating the `YotoPresentationState`, THE Presentation_Service SHALL record the `generatedAt` timestamp as an ISO 8601 UTC string.
9. IF Penni plan data is unavailable at generation time, THEN THE Presentation_Service SHALL omit all optional fields from the `YotoPresentationState` and SHALL set `activityPromptId` to a designated fallback prompt identifier.

---

### Requirement 5: Audio Endpoint

**User Story:** As a child, I want to hear a short spoken update when I insert my Penni card, so that I can understand my savings progress without needing a screen.

#### Acceptance Criteria

1. THE Audio_Endpoint SHALL accept requests authenticated by a `Media_Access_Token` path or query parameter.
2. WHEN a valid `Media_Access_Token` and a recognised chapter identifier are provided, THE Audio_Endpoint SHALL return an MP3 audio file with `Content-Type: audio/mpeg`.
3. WHEN chapter 1 ("My Penni update") is requested, THE Audio_Endpoint SHALL generate a spoken script derived from the current `YotoPresentationState`, announcing the child's Penni pot total and their progress as a percentage of their current savings goal (0–100%).
4. WHEN `Balance_Mode` is `hidden` and chapter 1 is requested, THE Audio_Endpoint SHALL NOT include any numerical currency value in the spoken script.
5. WHEN chapter 2 ("What changed?") is requested, THE Audio_Endpoint SHALL generate a spoken script describing the weekly change from `weeklyChangePence` without referencing individual banking transactions; if `weeklyChangePence` is zero, the script SHALL state that the amount is unchanged.
6. WHEN chapter 3 ("Family money moment") is requested, THE Audio_Endpoint SHALL return a fixed prerecorded MP3 prompt.
7. IF an invalid or unrecognised `Media_Access_Token` is provided, THEN THE Audio_Endpoint SHALL respond with HTTP 401 and SHALL NOT return audio content.
8. IF a valid `Media_Access_Token` is provided but the chapter identifier is unrecognised, THEN THE Audio_Endpoint SHALL respond with HTTP 404.
9. THE Audio_Endpoint SHALL set `Cache-Control: private, no-store` on all responses.
10. THE Audio_Endpoint SHALL NOT log the `Media_Access_Token` value or any child name present in the request path.
11. IF `YotoPresentationState` is unavailable when chapter 1 or chapter 2 is requested, THEN THE Audio_Endpoint SHALL respond with HTTP 503 and SHALL NOT return audio content.
12. IF the prerecorded MP3 asset for chapter 3 is unavailable, THEN THE Audio_Endpoint SHALL respond with HTTP 503 and SHALL NOT return partial audio content.

---

### Requirement 6: Icon Endpoint

**User Story:** As a child, I want to see a simple Penni icon on my Yoto player when my card is inserted, so that I know it is my Penni card.

#### Acceptance Criteria

1. IF a `Media_Access_Token` is present in the request path or query parameter, THEN THE Icon_Endpoint SHALL authenticate the request using that token before returning any response.
2. WHEN a valid `Media_Access_Token` is provided, THE Icon_Endpoint SHALL return a PNG image with exact pixel dimensions of 16 wide by 16 tall and a bit depth of 32-bit RGBA.
3. THE Icon_Endpoint SHALL set `Content-Type: image/png` on all successful responses.
4. WHEN `goalProgressPercent` is present in the current `YotoPresentationState`, THE Icon_Endpoint SHALL render a progress-based icon in which the filled area covers a proportion of the icon equal to `goalProgressPercent` divided by 100, accurate to within ±1 pixel row out of 16 pixel rows.
5. IF `goalProgressPercent` is absent from the current `YotoPresentationState`, THEN THE Icon_Endpoint SHALL return a static full-fill icon with no progress indicator.
6. IF the `Media_Access_Token` is missing, invalid, or unrecognised, THEN THE Icon_Endpoint SHALL respond with HTTP 401 and SHALL NOT return image content.
7. IF `YotoPresentationState` is unavailable when rendering the icon, THEN THE Icon_Endpoint SHALL respond with HTTP 503 and SHALL NOT return image content.
8. THE Icon_Endpoint SHALL set `Cache-Control: private, no-store` on all responses.

---

### Requirement 7: Balance Mode Setting

**User Story:** As a parent, I want to control whether my child's card reads out exact amounts, rounded amounts, or no amounts, so that I can choose what financial detail is appropriate for my child.

#### Acceptance Criteria

1. THE Penni_App SHALL present a balance mode control in the Yoto connection settings UI with the three options (`hidden`, `rounded`, `exact`) pre-selected to the currently persisted `Balance_Mode` value.
2. WHEN a parent saves a balance mode selection, THE Penni_App SHALL persist the chosen `Balance_Mode` value in the Connection_Store against the family's Yoto connection record.
3. WHEN the balance mode is changed and a `Penni_Playlist` exists, THE Penni_App SHALL regenerate the `YotoPresentationState` using the new `Balance_Mode` so that the next card play reflects the updated setting; IF no `Penni_Playlist` exists when the mode is changed, THEN THE Penni_App SHALL persist the new `Balance_Mode` without triggering playlist regeneration.
4. THE Penni_App SHALL default to `Balance_Mode: hidden` for all new Yoto connections.
5. IF `Balance_Mode` is `hidden`, THEN THE Audio_Endpoint SHALL NOT include any numerical currency value in any chapter response.
6. IF `Balance_Mode` is `rounded`, THEN THE Audio_Endpoint SHALL express the amount as the nearest whole pound (e.g., "about £12") when announcing the balance in chapter 1.
7. IF `Balance_Mode` is `exact`, THEN THE Audio_Endpoint SHALL express the amount in pounds and pence (e.g., "£12.34") when announcing the balance in chapter 1.

---

### Requirement 8: Parent Connection UI States

**User Story:** As a parent, I want the Yoto settings panel to clearly show the current connection state, so that I always know whether my child's card is set up and working.

#### Acceptance Criteria

1. THE Penni_App SHALL at all times display exactly one of the following connection states in the Yoto settings UI: `not_connected`, `connecting`, `connected_no_playlist`, `playlist_ready`, `ready`, or `needs_attention`.
2. IF connection status is `not_connected`, THEN THE Penni_App SHALL display the "Connect Yoto" action.
3. IF connection status is `connecting`, THEN THE Penni_App SHALL display a progress indicator and suppress other connection actions.
4. IF connection status is `connected_no_playlist`, THEN THE Penni_App SHALL display a "Create Penni playlist" action.
5. IF connection status is `playlist_ready`, THEN THE Penni_App SHALL display MYO card linking instructions and a "Preview" action.
6. IF connection status is `ready`, THEN THE Penni_App SHALL display a "Test / regenerate" action, the current balance mode control, and a "Disconnect" action.
7. IF connection status is `needs_attention`, THEN THE Penni_App SHALL display a message identifying which connection step requires action and a "Reconnect" action.
8. IF the Yoto API returns an error during any connection operation, THEN THE Penni_App SHALL display an error message expressed in user-facing terms that does not expose raw API error bodies, tokens, or internal identifiers, and that remains visible until the parent dismisses it or a subsequent operation supersedes it.

---

### Requirement 9: Disconnect and Data Removal

**User Story:** As a parent, I want to disconnect my Yoto account and optionally delete the Penni playlist, so that I can fully remove the integration when I no longer need it.

#### Acceptance Criteria

1. WHEN a parent selects "Disconnect", THE Penni_App SHALL revoke the Yoto access and refresh tokens via the Yoto API if the tokens are still valid.
2. WHEN a parent selects "Disconnect", THE Penni_App SHALL delete the encrypted tokens and connection record from the Connection_Store regardless of whether the Yoto-side revocation in criterion 1 succeeds.
3. WHEN disconnection is complete, THE Penni_App SHALL set the connection status to `not_connected` and clear all Yoto-related state for the family, including the stored access token, refresh token, Yoto account identifier, and any cached Penni_Playlist metadata.
4. WHEN a parent selects "Disconnect", THE Penni_App SHALL present a separate opt-in action to also delete the Penni_Playlist from the parent's Yoto library before executing the disconnection steps in criteria 1 and 2.
5. IF the parent does not opt in to playlist deletion, THEN THE Penni_App SHALL disconnect locally without deleting the Yoto playlist.
6. WHEN disconnected, THE Penni_App SHALL invalidate the Media_Access_Token for that connection so that subsequent requests to the Audio_Endpoint or Icon_Endpoint using the old token receive HTTP 401.
7. IF the parent opts in to playlist deletion and the Yoto API returns an error, THEN THE Penni_App SHALL continue with local disconnection and display an error message indicating that the playlist could not be deleted from the Yoto library.

---

### Requirement 10: Media Access Token Security

**User Story:** As a parent, I want the URLs that Yoto uses to fetch audio and icons to be secured and opaque, so that other parties cannot access or infer my family's data.

#### Acceptance Criteria

1. THE Penni_App SHALL generate a Media_Access_Token for each family Yoto connection using a cryptographically secure random generator with at least 128 bits of entropy.
2. THE Connection_Store SHALL store only the one-way hash of the Media_Access_Token, not the plaintext value.
3. WHEN the Audio_Endpoint or Icon_Endpoint receives a request, THE Penni_App SHALL hash the provided token and compare it to the stored hash; IF the hashes do not match or the token is absent, THEN THE Penni_App SHALL respond with HTTP 401 without distinguishing between missing and invalid tokens.
4. THE Penni_App SHALL NOT include family identifiers, child names, account numbers, or any personally identifiable information in the Audio_Endpoint or Icon_Endpoint URL paths.
5. WHEN a Media_Access_Token is rotated, THE Penni_App SHALL atomically update all playlist chapter URLs to reference the new token before invalidating the old token, ensuring no window where valid chapter URLs point to an invalidated token.
6. WHEN a Media_Access_Token is rotated, THE Penni_App SHALL invalidate the previous token so that any request using it receives HTTP 401.
7. THE Penni_App SHALL NOT log Media_Access_Token plaintext values in application logs at any severity level.

---

### Requirement 11: Data Isolation Between Families

**User Story:** As a parent, I want to be certain that no other Penni family can access my child's audio or icon content, so that our data remains private.

#### Acceptance Criteria

1. WHEN the Audio_Endpoint receives a request, THE Penni_App SHALL resolve the request only against the family associated with the authenticated Media_Access_Token.
2. WHEN the Icon_Endpoint receives a request, THE Penni_App SHALL resolve the request only against the family associated with the authenticated Media_Access_Token.
3. IF a valid Media_Access_Token belonging to Family A is used to request audio or icon content for Family B, THEN THE Penni_App SHALL respond with HTTP 401 and SHALL NOT return any content belonging to Family B.
4. WHEN validating a Media_Access_Token, THE Penni_App SHALL perform a server-side ownership check to confirm the token belongs to the requesting family's connection record; IF the ownership check fails, THEN THE Penni_App SHALL respond with HTTP 401 before returning any content.
5. IF an authenticated family session attempts to read the Yoto connection credentials of a different family, THEN THE Penni_App SHALL respond with HTTP 403 and SHALL NOT return the other family's connection details.

---

### Requirement 12: Presentation State Parsers and Round-Trip Integrity

**User Story:** As a developer, I want the `YotoPresentationState` serialisation and deserialisation to be verifiable, so that no data corruption or data leakage can occur through a codec bug.

#### Acceptance Criteria

1. THE Presentation_Service SHALL serialize `YotoPresentationState` objects to JSON conforming to the `YotoPresentationState` schema.
2. THE Presentation_Service SHALL deserialize JSON strings into `YotoPresentationState` objects, returning a structured error value with an `errorType` field and a `message` field for invalid input.
3. IF a JSON string does not conform to the `YotoPresentationState` schema, THEN THE Presentation_Service SHALL return a structured error value and SHALL NOT produce a partial state object.
4. FOR ALL valid `YotoPresentationState` objects, serialising then deserialising SHALL produce an object with identical values for every declared field.

---

### Requirement 13: Logging Safety

**User Story:** As a developer, I want all Yoto-related log entries to be free of sensitive data, so that logs cannot become a source of token or banking data leakage.

#### Acceptance Criteria

1. THE Penni_App SHALL NOT log Yoto access tokens, Yoto refresh tokens, or Media_Access_Token plaintext values at any log level.
2. THE Penni_App SHALL NOT log child names as part of URL paths or query strings in access logs.
3. THE Penni_App SHALL NOT log numeric balance amounts, account identifiers, or raw transaction records in any log path that is part of the Yoto integration code.
4. WHEN an error occurs in the OAuth_Service, Audio_Endpoint, or Icon_Endpoint, THE Penni_App SHALL log a structured error event containing exactly the error type, a per-request unique correlation ID, and an HTTP status code.

---

### Requirement 14: Offline and Fallback Behaviour

**User Story:** As a child, I want my Penni card to still work when Penni's servers are unavailable, so that inserting the card always gives me something useful.

#### Acceptance Criteria

1. IF the Audio_Endpoint is unreachable when the Yoto Player attempts to fetch chapter audio, THEN THE Yoto_Service SHALL fall back to any locally cached audio on the player.
2. IF no locally cached audio exists and the Audio_Endpoint is unreachable, THEN THE Yoto_Service SHALL play silence or nothing rather than produce an error tone.
3. THE Penni_App SHALL configure chapter 3 ("Family money moment") with a fixed, pre-uploaded MP3 asset to ensure that chapter is always available without a live Penni server call.
4. WHEN the Penni_App cannot derive a current `YotoPresentationState` due to a missing or expired TrueLayer token, THE Audio_Endpoint SHALL respond with a designated pre-uploaded fallback audio asset rather than an error tone.
5. IF connectivity to the Yoto API is lost during a playlist update, THEN THE Penni_App SHALL queue the update and retry with exponential back-off with an initial delay of at least 1 second and a maximum delay of 30 seconds, up to a maximum of 3 attempts.
