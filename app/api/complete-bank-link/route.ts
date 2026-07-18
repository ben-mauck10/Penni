import { NextRequest, NextResponse } from "next/server";
import {
  type TokenResponse,
  fetchTrueLayerDisplayBalance,
  getTrueLayerAuthBaseUrl,
  getTrueLayerDataApiBaseUrl,
  getTrueLayerRedirectUri,
  getUpstreamMessage,
  logTrueLayerDebug,
  readJson,
} from "../truelayer";

type CompleteBankLinkBody = {
  code?: unknown;
  state?: unknown;
};

const stateCookieName = "penny-pig-auth-state";
const refreshCookieName = "penny-pig-refresh-token";

function jsonWithClearedState(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.cookies.delete(stateCookieName);
  return response;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as CompleteBankLinkBody | null;
    const code = body?.code;
    const returnedState = body?.state;
    const expectedState = req.cookies.get(stateCookieName)?.value;

    if (typeof code !== "string" || !code.trim()) {
      return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
    }

    if (
      typeof returnedState !== "string" ||
      !returnedState.trim() ||
      !expectedState ||
      returnedState !== expectedState
    ) {
      return jsonWithClearedState(
        { error: "Bank link security check failed. Please try connecting again." },
        400
      );
    }

    const clientId = process.env.TRUELAYER_CLIENT_ID;
    const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;
    const redirectUri = getTrueLayerRedirectUri(req.nextUrl.origin);
    const authBase = getTrueLayerAuthBaseUrl();
    const dataApiBase = getTrueLayerDataApiBaseUrl();

    if (!clientId || !clientSecret || !redirectUri || !authBase || !dataApiBase) {
      return jsonWithClearedState({ error: "TrueLayer is not configured" }, 500);
    }

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
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
    const refreshToken = tokenData?.refresh_token;

    logTrueLayerDebug("complete-bank-link:token-exchange", {
      authBase,
      status: tokenResponse.status,
      ok: tokenResponse.ok,
    });

    if (!tokenData) {
      return jsonWithClearedState(
        { error: "TrueLayer returned an unreadable token response" },
        502
      );
    }

    if (!tokenResponse.ok || typeof accessToken !== "string" || !accessToken.trim()) {
      return jsonWithClearedState(
        { error: getUpstreamMessage(tokenData, "TrueLayer could not exchange the bank code") },
        tokenResponse.status
      );
    }

    const balanceResult = await fetchTrueLayerDisplayBalance(accessToken, dataApiBase);

    if (!balanceResult.ok) {
      return jsonWithClearedState(balanceResult.body, balanceResult.status);
    }

    const response = jsonWithClearedState(
      {
        balance: balanceResult.balance,
      },
      200
    );

    if (typeof refreshToken === "string" && refreshToken.trim()) {
      response.cookies.set(refreshCookieName, refreshToken, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 80,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }

    return response;
  } catch (error) {
    console.error("Failed to complete TrueLayer bank link", error);
    return jsonWithClearedState(
      { error: "Failed to finish bank connection" },
      500
    );
  }
}
