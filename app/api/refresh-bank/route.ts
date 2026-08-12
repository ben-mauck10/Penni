import { NextRequest, NextResponse } from "next/server";
import {
  type TokenResponse,
  fetchTrueLayerDisplayBalance,
  getTrueLayerAuthBaseUrl,
  getTrueLayerDataApiBaseUrl,
  getUpstreamMessage,
  logTrueLayerDebug,
  readJson,
} from "../truelayer";

const refreshCookieName = "penny-pig-refresh-token";

const COOKIE_OPTIONS = {
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 90, // 90 days — generous, TrueLayer tokens last ~60 days
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get(refreshCookieName)?.value;

    if (!refreshToken) {
      return NextResponse.json(
        { error: "no_refresh_token", message: "Bank not linked on this device. Connect the bank to get started." },
        { status: 401 }
      );
    }

    const clientId = process.env.TRUELAYER_CLIENT_ID;
    const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;
    const authBase = getTrueLayerAuthBaseUrl();
    const dataApiBase = getTrueLayerDataApiBaseUrl();

    if (!clientId || !clientSecret || !authBase || !dataApiBase) {
      return NextResponse.json({ error: "TrueLayer is not configured" }, { status: 500 });
    }

    const tokenBody = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    const tokenResponse = await fetch(`${authBase}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
      cache: "no-store",
    });

    const tokenData = (await readJson(tokenResponse)) as TokenResponse | null;

    logTrueLayerDebug("refresh-bank:token-exchange", {
      authBase,
      status: tokenResponse.status,
      ok: tokenResponse.ok,
    });

    if (!tokenData) {
      // TrueLayer returned garbage — don't clear the cookie, just fail gracefully.
      return NextResponse.json(
        { error: "TrueLayer returned an unreadable token response" },
        { status: 502 }
      );
    }

    if (!tokenResponse.ok) {
      // Only clear the cookie on a definitive "token invalid" response (400/401).
      // On 5xx or other transient errors, keep the cookie so the next attempt works.
      const isTokenInvalid = tokenResponse.status === 400 || tokenResponse.status === 401;
      const errorMsg = getUpstreamMessage(tokenData, "TrueLayer could not refresh the bank connection");

      const response = NextResponse.json({ error: errorMsg }, { status: tokenResponse.status });
      if (isTokenInvalid) {
        response.cookies.delete(refreshCookieName);
      }
      return response;
    }

    const accessToken = tokenData.access_token;
    const nextRefreshToken = tokenData.refresh_token;

    if (typeof accessToken !== "string" || !accessToken.trim()) {
      return NextResponse.json(
        { error: "TrueLayer did not return an access token" },
        { status: 502 }
      );
    }

    const balanceResult = await fetchTrueLayerDisplayBalance(accessToken, dataApiBase);

    if (!balanceResult.ok) {
      // Balance fetch failed — keep the refresh cookie intact for retry.
      return NextResponse.json(balanceResult.body, { status: balanceResult.status });
    }

    const response = NextResponse.json({ balance: balanceResult.balance }, { status: 200 });

    // Always re-set the cookie — refreshes its maxAge even if the token didn't rotate.
    const tokenToStore =
      typeof nextRefreshToken === "string" && nextRefreshToken.trim()
        ? nextRefreshToken
        : refreshToken; // fall back to the current token if TrueLayer didn't rotate it

    response.cookies.set(refreshCookieName, tokenToStore, COOKIE_OPTIONS);

    return response;
  } catch (error) {
    console.error("Failed to refresh TrueLayer bank link", error);
    return NextResponse.json({ error: "Failed to refresh bank connection" }, { status: 500 });
  }
}
