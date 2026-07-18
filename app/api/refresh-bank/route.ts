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

function jsonWithClearedRefresh(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.cookies.delete(refreshCookieName);
  return response;
}

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get(refreshCookieName)?.value;
    const clientId = process.env.TRUELAYER_CLIENT_ID;
    const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;
    const authBase = getTrueLayerAuthBaseUrl();
    const dataApiBase = getTrueLayerDataApiBaseUrl();

    if (!refreshToken) {
      return NextResponse.json(
        { error: "Bank refresh is not set up on this device. Connect the bank again." },
        { status: 401 }
      );
    }

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
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenBody,
      cache: "no-store",
    });
    const tokenData = (await readJson(tokenResponse)) as TokenResponse | null;
    const accessToken = tokenData?.access_token;
    const nextRefreshToken = tokenData?.refresh_token;

    logTrueLayerDebug("refresh-bank:token-exchange", {
      authBase,
      status: tokenResponse.status,
      ok: tokenResponse.ok,
    });

    if (!tokenData) {
      return NextResponse.json(
        { error: "TrueLayer returned an unreadable token response" },
        { status: 502 }
      );
    }

    if (!tokenResponse.ok || typeof accessToken !== "string" || !accessToken.trim()) {
      return jsonWithClearedRefresh(
        { error: getUpstreamMessage(tokenData, "TrueLayer could not refresh the bank connection") },
        tokenResponse.status
      );
    }

    const balanceResult = await fetchTrueLayerDisplayBalance(accessToken, dataApiBase);

    if (!balanceResult.ok) {
      return NextResponse.json(balanceResult.body, { status: balanceResult.status });
    }

    const response = NextResponse.json({ balance: balanceResult.balance }, { status: 200 });

    if (typeof nextRefreshToken === "string" && nextRefreshToken.trim()) {
      response.cookies.set(refreshCookieName, nextRefreshToken, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 80,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }

    return response;
  } catch (error) {
    console.error("Failed to refresh TrueLayer bank link", error);
    return NextResponse.json({ error: "Failed to refresh bank connection" }, { status: 500 });
  }
}
