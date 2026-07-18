type TrueLayerDebugPayload = Record<string, unknown>;

export type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
};

export type StoredBalance = {
  amount: number;
  currency: string;
  accountName: string;
  updatedAt?: string;
  fetchedAt: string;
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

type TrueLayerBalanceResult =
  | {
      ok: true;
      balance: StoredBalance;
    }
  | {
      ok: false;
      status: number;
      body: {
        error: string;
        debug?: unknown;
      };
    };

export function getTrueLayerAuthBaseUrl() {
  return process.env.TRUELAYER_AUTH_URL?.replace(/\/+$/, "");
}

export function getTrueLayerDataApiBaseUrl() {
  return process.env.TRUELAYER_DATA_API_URL?.replace(/\/+$/, "");
}

export function getTrueLayerRedirectUri(origin: string) {
  return process.env.TRUELAYER_REDIRECT_URI?.trim() || `${origin.replace(/\/+$/, "")}/callback`;
}

export async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

export function logTrueLayerDebug(event: string, payload: TrueLayerDebugPayload) {
  console.log(`[TrueLayer] ${event}`, payload);
}

export function getUpstreamMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const maybeDescription = "error_description" in data ? data.error_description : undefined;
    const maybeError = "error" in data ? data.error : undefined;
    const maybeMessage = "message" in data ? data.message : undefined;

    if (typeof maybeDescription === "string" && maybeDescription.trim()) {
      return maybeDescription;
    }

    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }

    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError;
    }
  }

  return fallback;
}

function chooseDisplayBalance(balance?: BalanceResult) {
  const current = balance?.current;
  const available = balance?.available;

  if (typeof current === "number" && typeof available === "number") {
    return available <= current ? available : current;
  }

  return current ?? available;
}

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

export async function fetchTrueLayerDisplayBalance(
  accessToken: string,
  dataApiBase: string
): Promise<TrueLayerBalanceResult> {
  const accountsResponse = await fetch(`${dataApiBase}/data/v1/accounts`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  const accountsData = (await readJson(accountsResponse)) as AccountsResponse | null;
  const firstAccount = accountsData?.results?.[0];

  logTrueLayerDebug("display-balance:accounts", {
    dataApiBase,
    status: accountsResponse.status,
    ok: accountsResponse.ok,
  });

  if (!accountsData) {
    return {
      ok: false,
      status: 502,
      body: {
        error: "TrueLayer returned an unreadable accounts response",
        debug: {
          route: "accounts",
          status: accountsResponse.status,
        },
      },
    };
  }

  if (!accountsResponse.ok) {
    return {
      ok: false,
      status: accountsResponse.status,
      body: {
        error: getUpstreamMessage(accountsData, "TrueLayer could not fetch accounts"),
        debug: {
          route: "accounts",
          status: accountsResponse.status,
          accountSummaries: summarizeAccounts(accountsData.results),
        },
      },
    };
  }

  if (!firstAccount?.account_id) {
    return {
      ok: false,
      status: 404,
      body: {
        error: "The bank link worked, but there was not an account to show yet.",
        debug: {
          route: "accounts",
          status: accountsResponse.status,
          accountSummaries: summarizeAccounts(accountsData.results),
        },
      },
    };
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
  const amount = chooseDisplayBalance(firstBalance);

  logTrueLayerDebug("display-balance:balance", {
    dataApiBase,
    status: balanceResponse.status,
    ok: balanceResponse.ok,
    accountId: firstAccount.account_id,
  });

  if (!balanceData) {
    return {
      ok: false,
      status: 502,
      body: {
        error: "TrueLayer returned an unreadable balance response",
        debug: {
          route: "balance",
          status: balanceResponse.status,
          accountId: firstAccount.account_id,
        },
      },
    };
  }

  if (!balanceResponse.ok || typeof amount !== "number") {
    return {
      ok: false,
      status: balanceResponse.status,
      body: {
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
    };
  }

  return {
    ok: true,
    balance: {
      amount,
      currency: firstBalance?.currency ?? "GBP",
      accountName: firstAccount.display_name ?? "First account",
      updatedAt: firstBalance?.update_timestamp,
      fetchedAt: new Date().toISOString(),
    },
  };
}
