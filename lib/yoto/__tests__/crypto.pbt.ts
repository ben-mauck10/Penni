/**
 * Property-based tests for lib/yoto/crypto.ts
 *
 * Feature: yoto-integration
 * Validates: Requirements 1.4, 1.6, 1.8
 */

import { describe, it, beforeAll } from "vitest";
import * as fc from "fast-check";
import { generateSecureToken, buildPkceParams, encryptToken, decryptToken } from "../crypto";

// Set a fixed 64-char hex key so AES-256-GCM is available in all tests.
// This key is for testing only and must never be used in production.
const TEST_KEY = "0".repeat(64);

beforeAll(() => {
  process.env.YOTO_ENCRYPTION_KEY = TEST_KEY;
});

// ---------------------------------------------------------------------------
// Property 7: PKCE state parameter has sufficient entropy
// ---------------------------------------------------------------------------

describe("Property 7: PKCE state parameter has sufficient entropy", () => {
  it("generateSecureToken(16) decodes to at least 16 raw bytes", () => {
    // Feature: yoto-integration, Property 7: PKCE state parameter has sufficient entropy
    fc.assert(
      fc.property(fc.constant(null), () => {
        const token = generateSecureToken(16);
        // Restore standard base64 from base64url before measuring raw length
        const rawBytes = Buffer.from(
          token.replace(/-/g, "+").replace(/_/g, "/"),
          "base64"
        );
        return rawBytes.length >= 16;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: PKCE code_verifier length is within RFC 7636 bounds
// ---------------------------------------------------------------------------

describe("Property 8: PKCE code_verifier length is within RFC 7636 bounds", () => {
  it("buildPkceParams().codeVerifier length is in [43, 128]", () => {
    // Feature: yoto-integration, Property 8: PKCE code_verifier length is within RFC 7636 bounds
    fc.assert(
      fc.property(fc.constant(null), () => {
        const { codeVerifier } = buildPkceParams();
        return codeVerifier.length >= 43 && codeVerifier.length <= 128;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Encrypt then decrypt is identity
// ---------------------------------------------------------------------------

describe("Property 9: Encrypt then decrypt is identity", () => {
  it("decryptToken(encryptToken(s)) === s for any non-empty string", () => {
    // Feature: yoto-integration, Property 9: Encrypt then decrypt is identity
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (s) => {
        return decryptToken(encryptToken(s)) === s;
      }),
      { numRuns: 100 }
    );
  });
});
