import crypto from "crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a base64 string to base64url by replacing unsafe characters and
 * stripping padding.
 */
function toBase64url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Reads and validates YOTO_ENCRYPTION_KEY from the environment.
 * Must be a 64-character hex string representing 32 bytes.
 */
function getEncryptionKey(): Buffer {
  const hex = process.env.YOTO_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "YOTO_ENCRYPTION_KEY environment variable is not set. " +
        "It must be a 64-character hex string (32 bytes)."
    );
  }
  if (hex.length !== 64) {
    throw new Error(
      `YOTO_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes), ` +
        `but got ${hex.length} characters.`
    );
  }
  return Buffer.from(hex, "hex");
}

// ---------------------------------------------------------------------------
// 3.1 — generateSecureToken
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically secure random token encoded as base64url.
 *
 * @param bytes - Number of random bytes to use (default 32 = 256 bits).
 * @returns Base64url-encoded string (no padding characters).
 */
export function generateSecureToken(bytes = 32): string {
  return toBase64url(crypto.randomBytes(bytes).toString("base64"));
}

// ---------------------------------------------------------------------------
// 3.2 — hashToken
// ---------------------------------------------------------------------------

/**
 * Returns the SHA-256 hex digest of the given token string.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// 3.2b — signed media tokens
// ---------------------------------------------------------------------------

/**
 * Creates a stateless token for Yoto media URLs.
 *
 * The family ID is encoded, then signed with HMAC-SHA256 using the same
 * 32-byte deployment secret as OAuth token encryption. This avoids depending
 * on Vercel's temporary SQLite file for Yoto's later audio/icon requests.
 */
export function createSignedMediaToken(familyId: string): string {
  const payload = toBase64url(Buffer.from(familyId, "utf8").toString("base64"));
  const signature = crypto
    .createHmac("sha256", getEncryptionKey())
    .update(payload)
    .digest("base64url");

  return `v1.${payload}.${signature}`;
}

/**
 * Verifies a stateless Yoto media URL token.
 *
 * Returns the family ID when the token is valid, otherwise `null`.
 */
export function verifySignedMediaToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return null;
  }

  const [, payload, signature] = parts;
  const expected = crypto
    .createHmac("sha256", getEncryptionKey())
    .update(payload)
    .digest("base64url");

  const signatureBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    signatureBytes.length !== expectedBytes.length ||
    !crypto.timingSafeEqual(signatureBytes, expectedBytes)
  ) {
    return null;
  }

  try {
    const familyId = fromBase64url(payload).toString("utf8");
    return familyId.length > 0 ? familyId : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3.3 — encryptToken
// ---------------------------------------------------------------------------

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * Key is read from `YOTO_ENCRYPTION_KEY` (64-char hex = 32 bytes).
 * A unique 12-byte IV is generated for every call.
 *
 * @returns Stored format: `${iv_hex}:${ciphertext_base64url}:${authTag_hex}`
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const ivHex = iv.toString("hex");
  const ciphertextBase64url = toBase64url(encrypted.toString("base64"));
  const authTagHex = authTag.toString("hex");

  return `${ivHex}:${ciphertextBase64url}:${authTagHex}`;
}

// ---------------------------------------------------------------------------
// 3.4 — decryptToken
// ---------------------------------------------------------------------------

/**
 * Decrypts a ciphertext string produced by `encryptToken`.
 *
 * Verifies the GCM auth tag — throws if the tag is invalid or the format
 * cannot be parsed.
 *
 * @param ciphertext - Stored format: `${iv_hex}:${ciphertext_base64url}:${authTag_hex}`
 * @returns The original plaintext string.
 */
export function decryptToken(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "Invalid ciphertext format. Expected `iv_hex:ciphertext_base64url:authTag_hex`."
    );
  }

  const [ivHex, ciphertextBase64url, authTagHex] = parts;

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  // Restore standard base64 from base64url before decoding
  const ciphertextBuf = Buffer.from(
    ciphertextBase64url.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  );
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertextBuf),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error(
      "Decryption failed: GCM authentication tag mismatch or corrupted ciphertext."
    );
  }
}

// ---------------------------------------------------------------------------
// 3.5 — buildPkceParams
// ---------------------------------------------------------------------------

/**
 * Generates PKCE parameters for an OAuth 2.0 authorization-code flow.
 *
 * - `codeVerifier`: 32 random bytes encoded as base64url → 43 characters,
 *   satisfying RFC 7636's [43, 128] requirement using URL-safe characters only.
 * - `codeChallenge`: SHA-256 of the verifier bytes, base64url-encoded (S256 method).
 */
export function buildPkceParams(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  const codeVerifier = generateSecureToken(32);
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return { codeVerifier, codeChallenge };
}
