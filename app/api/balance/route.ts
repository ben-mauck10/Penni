import { NextRequest, NextResponse } from "next/server";
import {
  getTokenHint,
  getTrueLayerDataApiBaseUrl,
  getUpstreamMessage,
  logTrueLayerDebug,
} from "../truelayer";

type BalanceBody = {
  accessToken?: unknown;
  accountId?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as BalanceBody | null;
    const accessToken = body?.accessToken;
    const accountId = body?.accountId;

    if (typeof accessToken !== "string" || !accessToken.trim()) {
      return NextResponse.json({ error: "Missing access token" }, { status: 400 });
    }

    if (typeof accountId !== "string" || !accountId.trim()) {
      return NextResponse.json(
        { error: "Missing accountId" },
        { status: 400 }
      );
    }

    const dataApiBase = getTrueLayerDataApiBaseUrl();

    if (!dataApiBase) {
      return NextResponse.json(
        { error: "TrueLayer Data API is not configured" },
        { status: 500 }
      );
    }

    const response = await fetch(
      `${dataApiBase}/data/v1/accounts/${encodeURIComponent(accountId)}/balance`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      }
    );

    const data = await response.json().catch(() => null);

    logTrueLayerDebug("balance", {
      dataApiBase,
      status: response.status,
      ok: response.ok,
      accountId,
      token: getTokenHint(accessToken),
    });

    if (!data) {
      return NextResponse.json(
        {
          error: "TrueLayer returned an unreadable balance response",
          debug: {
            dataApiBase,
            status: response.status,
            accountId,
          },
        },
        { status: 502 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error: getUpstreamMessage(data, "TrueLayer could not fetch the balance"),
          debug: {
            dataApiBase,
            status: response.status,
            accountId,
            upstream: data,
          },
        },
        { status: response.status }
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Failed to fetch TrueLayer balance", error);
    return NextResponse.json(
      { error: "Failed to fetch balance" },
      { status: 500 }
    );
  }
}
