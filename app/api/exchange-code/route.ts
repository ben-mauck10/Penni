import { NextRequest, NextResponse } from "next/server";
import {
  getTrueLayerAuthBaseUrl,
  getUpstreamMessage,
  logTrueLayerDebug,
} from "../truelayer";

type ExchangeCodeBody = {
  code?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as ExchangeCodeBody | null;
    const code = body?.code;

    const clientId = process.env.TRUELAYER_CLIENT_ID;
    const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;
    const redirectUri = process.env.TRUELAYER_REDIRECT_URI;
    const authBase = getTrueLayerAuthBaseUrl();

    if (typeof code !== "string" || !code.trim()) {
      return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
    }

    if (!clientId || !clientSecret || !redirectUri || !authBase) {
      return NextResponse.json(
        { error: "TrueLayer is not configured" },
        { status: 500 }
      );
    }

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    });

    const response = await fetch(`${authBase}/connect/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenBody,
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);

    logTrueLayerDebug("token-exchange", {
      authBase,
      status: response.status,
      ok: response.ok,
    });

    if (!data) {
      return NextResponse.json(
        { error: "TrueLayer returned an unreadable token response" },
        { status: 502 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: getUpstreamMessage(data, "TrueLayer could not exchange the bank code") },
        { status: response.status }
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Failed to exchange TrueLayer code", error);
    return NextResponse.json(
      { error: "Failed to exchange code" },
      { status: 500 }
    );
  }
}
