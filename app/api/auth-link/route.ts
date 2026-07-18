import { NextResponse } from "next/server";
import { getTrueLayerAuthBaseUrl, getTrueLayerRedirectUri, logTrueLayerDebug } from "../truelayer";

const stateCookieName = "penny-pig-auth-state";

export async function GET(req: Request) {
  try {
    const clientId = process.env.TRUELAYER_CLIENT_ID;
    const redirectUri = getTrueLayerRedirectUri(new URL(req.url).origin);
    const authBase = getTrueLayerAuthBaseUrl();
    const providers = process.env.TRUELAYER_PROVIDERS;
    const state = crypto.randomUUID();

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
      state,
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
      hasState: true,
    });

    const response = NextResponse.redirect(authUrl);
    response.cookies.set(stateCookieName, state, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (error) {
    console.error("Failed to build TrueLayer auth link", error);
    return NextResponse.json(
      { error: "Failed to start bank connection" },
      { status: 500 }
    );
  }
}
