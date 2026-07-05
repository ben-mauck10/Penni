import { NextRequest, NextResponse } from "next/server";
import {
  getTrueLayerAuthBaseUrl,
  getTrueLayerDataApiBaseUrl,
  getUpstreamMessage,
  logTrueLayerDebug,
} from "../truelayer";

type CompleteBankLinkBody = {
  code?: unknown;
  state?: unknown;
};

type TokenResponse = {
  access_token?: unknown;
};

type Account = {
  account_id?: string;
  display_name?: string;
  account_type?: string;
  currency?: string;
  provider?: {
    display_name?: string;
    provider_id?: string;
  };
};

type AccountsResponse = {
  results?: Account[];
};

type BalanceResult = {
  available?: number;
  current?: number;
  currency?: string;
  update_timestamp?: string;
};

type BalanceResponse = {
  results?: BalanceResult[];
};

const stateCookieName = "penny-pig-auth-state";

function summarizeAccounts(accounts?: Account[]) {
  return accounts?.map((account, index) => ({
    index,
    account_id: account.account_id,
    display_name: account.display_name,
    account_type: account.account_type,
    currency: account.currency,
    provider: account.provider
      ? {
          display_name: account.provider.display_name,
          provider_id: account.provider.provider_id,
        }
      : undefined,
  }));
}

function jsonWithClearedState(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.cookies.delete(stateCookieName);
  return response;
}

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
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
    const redirectUri = process.env.TRUELAYER_REDIRECT_URI;
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

    const accountsResponse = await fetch(`${dataApiBase}/data/v1/accounts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
    const accountsData = (await readJson(accountsResponse)) as AccountsResponse | null;
    const firstAccount = accountsData?.results?.[0];

    logTrueLayerDebug("complete-bank-link:accounts", {
      dataApiBase,
      status: accountsResponse.status,
      ok: accountsResponse.ok,
    });

    if (!accountsData) {
      return jsonWithClearedState(
        {
          error: "TrueLayer returned an unreadable accounts response",
          debug: {
            route: "accounts",
            status: accountsResponse.status,
          },
        },
        502
      );
    }

    if (!accountsResponse.ok) {
      return jsonWithClearedState(
        {
          error: getUpstreamMessage(accountsData, "TrueLayer could not fetch accounts"),
          debug: {
            route: "accounts",
            status: accountsResponse.status,
            accountSummaries: summarizeAccounts(accountsData.results),
          },
        },
        accountsResponse.status
      );
    }

    if (!firstAccount?.account_id) {
      return jsonWithClearedState(
        {
          error: "The bank link worked, but there was not an account to show yet.",
          debug: {
            route: "accounts",
            status: accountsResponse.status,
            accountSummaries: summarizeAccounts(accountsData.results),
          },
        },
        404
      );
    }

    const balanceResponse = await fetch(
      `${dataApiBase}/data/v1/accounts/${encodeURIComponent(firstAccount.account_id)}/balance`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      }
    );
    const balanceData = (await readJson(balanceResponse)) as BalanceResponse | null;
    const firstBalance = balanceData?.results?.[0];
    const amount = firstBalance?.current ?? firstBalance?.available;

    logTrueLayerDebug("complete-bank-link:balance", {
      dataApiBase,
      status: balanceResponse.status,
      ok: balanceResponse.ok,
      accountId: firstAccount.account_id,
    });

    if (!balanceData) {
      return jsonWithClearedState(
        {
          error: "TrueLayer returned an unreadable balance response",
          debug: {
            route: "balance",
            status: balanceResponse.status,
            accountId: firstAccount.account_id,
          },
        },
        502
      );
    }

    if (!balanceResponse.ok || typeof amount !== "number") {
      return jsonWithClearedState(
        {
          error: getUpstreamMessage(balanceData, "The account was found, but its balance was not ready."),
          debug: {
            route: "balance",
            status: balanceResponse.status,
            selectedAccount: {
              account_id: firstAccount.account_id,
              display_name: firstAccount.display_name,
              account_type: firstAccount.account_type,
            },
            accountSummaries: summarizeAccounts(accountsData.results),
          },
        },
        balanceResponse.status
      );
    }

    return jsonWithClearedState(
      {
        balance: {
          amount,
          currency: firstBalance?.currency ?? "GBP",
          accountName: firstAccount.display_name ?? "First account",
          updatedAt: firstBalance?.update_timestamp,
          fetchedAt: new Date().toISOString(),
        },
      },
      200
    );
  } catch (error) {
    console.error("Failed to complete TrueLayer bank link", error);
    return jsonWithClearedState(
      { error: "Failed to finish bank connection" },
      500
    );
  }
}
