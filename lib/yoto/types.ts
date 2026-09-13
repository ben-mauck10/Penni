// Shared Yoto integration types

export type BalanceMode = "hidden" | "rounded" | "exact";

export type ConnectionStatus =
  | "not_connected"
  | "connecting"
  | "connected_no_playlist"
  | "playlist_ready"
  | "ready"
  | "needs_attention";

export type YotoConnection = {
  familyId: string;                    // opaque identifier for this Penni installation
  yotoAccountId: string | null;        // Yoto user identifier returned after OAuth
  status: ConnectionStatus;
  encryptedAccessToken: string | null; // AES-256-GCM ciphertext
  accessTokenExpiresAt: string | null; // ISO 8601 UTC
  encryptedRefreshToken: string | null;
  playlistId: string | null;           // Yoto card/content ID
  mediaTokenHash: string | null;       // SHA-256 hex of the Media Access Token
  balanceMode: BalanceMode;
  oauthState: string | null;           // temp: PKCE state (cleared after callback)
  oauthCodeVerifier: string | null;    // temp: PKCE verifier (cleared after callback)
  oauthExpiresAt: string | null;       // temp: 10-minute expiry for pending flow
  updatedAt: string;                   // ISO 8601 UTC
};

export type YotoPresentationState = {
  childDisplayName?: string;           // optional, from parent settings
  balanceMode: BalanceMode;            // required
  availableAmountPence?: number;       // conditional integer (omitted when hidden)
  goalName?: string;                   // first active save goal name
  goalProgressPercent?: number;        // integer 0–100, capped at 100
  weeklyChangePence?: number;          // positive = net saving, negative = net spending
  activityPromptId: string;            // required; "fallback" when data unavailable
  generatedAt: string;                 // ISO 8601 UTC
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO 8601 UTC
};
