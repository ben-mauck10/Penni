import { NextRequest, NextResponse } from "next/server";
import {
  getTokenHint,
  getTrueLayerDataApiBaseUrl,
  getUpstreamMessage,
  logTrueLayerDebug,
} from "../truelayer";

type AccountsBody = {
  accessToken?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as AccountsBody | null;
    const accessToken = body?.accessToken;

    if (typeof accessToken !== "string" || !accessToken.trim()) {
      return NextResponse.json({ error: "Missing access token" }, { status: 400 });
    }

    const dataApiBase = getTrueLayerDataApiBaseUrl();

    if (!dataApiBase) {
      return NextResponse.json(
        { error: "TrueLayer Data API is not configured" },
        { status: 500 }
      );
    }

    const response = await fetch(`${dataApiBase}/data/v1/accounts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);

    logTrueLayerDebug("accounts", {
      dataApiBase,
      status: response.status,
      ok: response.ok,
      token: getTokenHint(accessToken),
      body: data,
    });

    if (!data) {
      return NextResponse.json(
        {
          error: "TrueLayer returned an unreadable accounts response",
          debug: {
            dataApiBase,
            status: response.status,
          },
        },
        { status: 502 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error: getUpstreamMessage(data, "TrueLayer could not fetch accounts"),
          debug: {
            dataApiBase,
            status: response.status,
            upstream: data,
          },
        },
        { status: response.status }
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Failed to fetch TrueLayer accounts", error);
    return NextResponse.json(
      { error: "Failed to fetch accounts" },
      { status: 500 }
    );
  }
}
