import { NextResponse } from "next/server";
import { buildAuthUrl, isPendingFlowExpired } from "../../../../lib/yoto/oauth";
import {
  clearPendingOAuth,
  getConnection,
  getFamilyId,
  upsertConnection,
} from "../../../../lib/yoto/db";

export const runtime = "nodejs";

const PKCE_COOKIE_NAME = "yoto_pkce";

export async function GET(req: Request) {
  try {
    const origin = new URL(req.url).origin;
    const familyId = getFamilyId();
    const existing = getConnection(familyId);

    if (existing && existing.status === "connecting" && isPendingFlowExpired(existing)) {
      clearPendingOAuth(familyId, "not_connected");
    } else if (
      existing &&
      existing.status !== "not_connected" &&
      existing.status !== "needs_attention"
    ) {
      return NextResponse.redirect(`${origin}/yoto/settings`);
    }

    const { url, state, codeVerifier } = buildAuthUrl(origin);

    const oauthExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Persist PKCE fields to the connection record.
    upsertConnection({
      familyId,
      status: "connecting",
      oauthState: state,
      oauthCodeVerifier: codeVerifier,
      oauthExpiresAt,
    });

    // Store PKCE params in an httpOnly cookie so the callback can validate them.
    const cookieValue = JSON.stringify({
      state,
      codeVerifier,
      expiresAt: oauthExpiresAt,
    });

    const response = NextResponse.redirect(url);
    response.cookies.set(PKCE_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      maxAge: 600,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (error) {
    console.error("[yoto/auth-link] Failed to build Yoto auth link", error);
    return NextResponse.json(
      { error: "Failed to start Yoto connection" },
      { status: 500 }
    );
  }
}
