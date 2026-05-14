"use client";

import { useEffect, useState } from "react";

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
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
  error?: string;
  message?: string;
  error_description?: string;
  debug?: unknown;
};

type BalanceResult = {
  available?: number;
  current?: number;
  currency?: string;
  update_timestamp?: string;
};

type BalanceResponse = {
  results?: BalanceResult[];
  error?: string;
  message?: string;
  error_description?: string;
  debug?: unknown;
};

type StoredBalance = {
  amount: number;
  currency: string;
  accountName: string;
  updatedAt?: string;
  fetchedAt: string;
};

type CallbackState = {
  kind: "loading" | "success" | "error";
  title: string;
  message: string;
  debug?: unknown;
};

const storageKey = "penny-pig-balance";

function getApiMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const maybeError = "error" in data ? data.error : undefined;
    const maybeMessage = "message" in data ? data.message : undefined;
    const maybeDescription = "error_description" in data ? data.error_description : undefined;

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

async function postJson<T>(url: string, body: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as T;
  return { data, ok: response.ok, status: response.status };
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

export default function CallbackPage() {
  const [state, setState] = useState<CallbackState>({
    kind: "loading",
    title: "Checking your bank link",
    message: "Penny Pig is finishing the bank connection.",
  });

  useEffect(() => {
    let cancelled = false;

    const setSafeState = (nextState: CallbackState) => {
      if (!cancelled) {
        setState(nextState);
      }
    };

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const returnedCode = params.get("code");
      const error = params.get("error");
      const errorDescription = params.get("error_description");

      if (error) {
        setSafeState({
          kind: "error",
          title: "Bank link stopped",
          message: errorDescription ?? "TrueLayer did not finish connecting the account.",
        });
        return;
      }

      if (!returnedCode) {
        setSafeState({
          kind: "error",
          title: "No bank code found",
          message: "Try connecting your bank again so Penny Pig can read the balance.",
        });
        return;
      }

      setSafeState({
        kind: "loading",
        title: "Opening the money jar",
        message: "Penny Pig is checking the first account now.",
      });

      const tokenResult = await postJson<TokenResponse>("/api/exchange-code", {
        code: returnedCode,
      });

      if (!tokenResult.ok || !tokenResult.data.access_token) {
        setSafeState({
          kind: "error",
          title: "Could not connect",
          message: getApiMessage(tokenResult.data, "The bank code could not be exchanged."),
        });
        return;
      }

      const accessToken = tokenResult.data.access_token;

      const accountsResult = await postJson<AccountsResponse>("/api/accounts", {
        accessToken,
      });
      const firstAccount = accountsResult.data.results?.[0];

      if (!accountsResult.ok) {
        setSafeState({
          kind: "error",
          title: "Could not load accounts",
          message: `TrueLayer returned: ${getApiMessage(
            accountsResult.data,
            "TrueLayer could not return account data."
          )}`,
          debug: {
            route: "/api/accounts",
            status: accountsResult.status,
            response: accountsResult.data,
            accountSummaries: summarizeAccounts(accountsResult.data.results),
          },
        });
        return;
      }

      if (!firstAccount?.account_id) {
        setSafeState({
          kind: "error",
          title: "No account found",
          message: "The bank link worked, but there was not an account to show yet.",
          debug: {
            route: "/api/accounts",
            status: accountsResult.status,
            response: accountsResult.data,
            accountSummaries: summarizeAccounts(accountsResult.data.results),
          },
        });
        return;
      }

      const balanceResult = await postJson<BalanceResponse>("/api/balance", {
        accessToken,
        accountId: firstAccount.account_id,
      });
      const firstBalance = balanceResult.data.results?.[0];
      const amount = firstBalance?.available ?? firstBalance?.current;

      if (!balanceResult.ok || typeof amount !== "number") {
        setSafeState({
          kind: "error",
          title: "Could not read the balance",
          message: getApiMessage(balanceResult.data, "The account was found, but its balance was not ready."),
          debug: {
            route: "/api/balance",
            status: balanceResult.status,
            selectedAccount: {
              account_id: firstAccount.account_id,
              display_name: firstAccount.display_name,
              account_type: firstAccount.account_type,
            },
            accountSummaries: summarizeAccounts(accountsResult.data.results),
            response: balanceResult.data,
          },
        });
        return;
      }

      const storedBalance: StoredBalance = {
        amount,
        currency: firstBalance?.currency ?? "GBP",
        accountName: firstAccount.display_name ?? "First account",
        updatedAt: firstBalance?.update_timestamp,
        fetchedAt: new Date().toISOString(),
      };

      sessionStorage.setItem(storageKey, JSON.stringify(storedBalance));

      setSafeState({
        kind: "success",
        title: "Balance ready",
        message: "Heading back home with the number for your Penny Pig card.",
      });

      window.location.replace("/?connected=1");
    };

    run().catch(() => {
      setSafeState({
        kind: "error",
        title: "Something wobbled",
        message: "Penny Pig could not finish the bank check. Please try again.",
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="callback-page">
      <section className={`callback-panel callback-panel--${state.kind}`} aria-live="polite">
        <div className="pig-mark" aria-hidden="true">
          <span />
          <span />
        </div>
        <p className="eyebrow">TrueLayer callback</p>
        <h1>{state.title}</h1>
        <p>{state.message}</p>
        {state.debug !== undefined && (
          <details className="debug-panel">
            <summary>Developer debug details</summary>
            <pre>{JSON.stringify(state.debug, null, 2)}</pre>
          </details>
        )}
        {state.kind === "error" && (
          <a className="button-link" href="/api/auth-link">
            Try bank link again
          </a>
        )}
      </section>
    </main>
  );
}
