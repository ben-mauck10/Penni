"use client";

import { useEffect, useState } from "react";

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

type CompleteBankLinkResponse = {
  balance?: StoredBalance;
  error?: string;
  message?: string;
  error_description?: string;
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
      const returnedState = params.get("state");
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

      if (!returnedState) {
        setSafeState({
          kind: "error",
          title: "Security check missing",
          message: "Try connecting your bank again so Penny Pig can verify the bank link.",
        });
        return;
      }

      setSafeState({
        kind: "loading",
        title: "Opening the money jar",
        message: "Penny Pig is checking the first account now.",
      });

      const linkResult = await postJson<CompleteBankLinkResponse>("/api/complete-bank-link", {
        code: returnedCode,
        state: returnedState,
      });

      if (!linkResult.ok || !linkResult.data.balance) {
        setSafeState({
          kind: "error",
          title: "Could not read the balance",
          message: getApiMessage(linkResult.data, "Penny Pig could not finish checking the account."),
          debug: linkResult.data.debug
            ? {
                route: "/api/complete-bank-link",
                status: linkResult.status,
                details: linkResult.data.debug,
              }
            : undefined,
        });
        return;
      }

      const storedBalance = JSON.stringify(linkResult.data.balance);
      localStorage.setItem(storageKey, storedBalance);
      sessionStorage.setItem(storageKey, storedBalance);

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
