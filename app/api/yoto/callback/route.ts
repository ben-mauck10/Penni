import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, isPendingFlowExpired } from "../../../../lib/yoto/oauth";
import {
  clearPendingOAuth,
  getFamilyId,
  getConnection,
} from "../../../../lib/yoto/db";

export const runtime = "nodejs";

const PKCE_COOKIE_NAME = "yoto_pkce";

function errorRedirect(reason: string, origin: string): NextResponse {
  return NextResponse.redirect(
    `${origin}/yoto/settings?yoto=error&reason=${reason}`
  );
}

function errorReason(error: unknown): string {
  if (error && typeof error === "object" && "errorType" in error) {
    const errorType = String((error as { errorType: unknown }).errorType);
    if (/^[a-z0-9_]+$/.test(errorType)) {
      return errorType;
    }
  }

  return "exchange_failed";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  // Read the PKCE cookie.
  const cookieStore = await cookies();
  const pkceCookie = cookieStore.get(PKCE_COOKIE_NAME);

  if (!pkceCookie?.value) {
    return errorRedirect("no_session", origin);
  }

  let pkce: { state: string; codeVerifier: string; expiresAt: string };
  try {
    pkce = JSON.parse(pkceCookie.value);
  } catch {
    return errorRedirect("no_session", origin);
  }

  // Check for OAuth errors (e.g. user denied access).
  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    return errorRedirect("denied", origin);
  }

  // Validate state parameter.
  const returnedState = url.searchParams.get("state");
  if (!returnedState || returnedState !== pkce.state) {
    return errorRedirect("state_mismatch", origin);
  }

  // Check if the pending flow has expired.
  const familyId = getFamilyId();
  const conn = getConnection(familyId);

  if (conn?.oauthState || conn?.oauthCodeVerifier) {
    if (
      conn.oauthState !== pkce.state ||
      conn.oauthCodeVerifier !== pkce.codeVerifier ||
      conn.oauthState !== returnedState
    ) {
      clearPendingOAuth(familyId, "not_connected");
      return errorRedirect("state_mismatch", origin);
    }
  }

  if (conn && isPendingFlowExpired(conn)) {
    clearPendingOAuth(familyId, "not_connected");
    return errorRedirect("expired", origin);
  } else if (new Date(pkce.expiresAt).getTime() < Date.now()) {
    if (conn) {
      clearPendingOAuth(familyId, "not_connected");
    }
    return errorRedirect("expired", origin);
  }

  // Exchange the authorization code.
  const code = url.searchParams.get("code");
  if (!code) {
    return errorRedirect("exchange_failed", origin);
  }

  try {
    await exchangeCode(code, pkce.codeVerifier, familyId, origin);
    if (conn) {
      clearPendingOAuth(familyId);
    }
  } catch (error) {
    if (conn) {
      clearPendingOAuth(familyId, "not_connected");
    }
    return errorRedirect(errorReason(error), origin);
  }

  // Success — clear the PKCE cookie and redirect.
  const response = NextResponse.redirect(`${origin}/yoto/settings?yoto=connected`);
  response.cookies.set(PKCE_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
