import { NextResponse } from "next/server";
import { getTrueLayerAuthBaseUrl, logTrueLayerDebug } from "../truelayer";

export async function GET() {
  try {
    const clientId = process.env.TRUELAYER_CLIENT_ID;
    const redirectUri = process.env.TRUELAYER_REDIRECT_URI;
    const authBase = getTrueLayerAuthBaseUrl();
    const providers = process.env.TRUELAYER_PROVIDERS;

    if (!clientId || !redirectUri || !authBase) {
      return NextResponse.json(
        { error: "TrueLayer is not configured" },
        { status: 500 }
      );
    }

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "info accounts balance transactions",
    });

    if (providers) {
      params.set("providers", providers);
    }

    const authUrl = new URL(authBase);
    authUrl.search = params.toString();

    logTrueLayerDebug("auth-link", {
      authBase,
      redirectUri,
      providers: providers ?? "(not set)",
    });

    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error("Failed to build TrueLayer auth link", error);
    return NextResponse.json(
      { error: "Failed to start bank connection" },
      { status: 500 }
    );
  }
}
