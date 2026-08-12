"use client";

import Link from "next/link";
import { type TouchEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  formatLastChecked,
  formatMoney,
  roundMoney,
} from "../../lib/money";
import {
  BALANCE_UPDATED_EVENT,
  KEYS,
  dispatchBalanceUpdated,
  parseStoredBalance,
  parseStoredPlan,
  writeBalance,
} from "../../lib/storage";
import type { PenniPlan, StoredBalance } from "../../lib/types";

// ── Types ─────────────────────────────────────────────────────

type WakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

type WakeLockState = "unsupported" | "insecure" | "available" | "active" | "blocked";
type RefreshState = "idle" | "refreshing" | "success" | "needs-connection" | "error";

type RefreshBankResponse = {
  balance?: StoredBalance;
  error?: string;
};

// ── Constants ─────────────────────────────────────────────────

const DEFAULT_SAVE_GOALS = [{ id: "default", name: "Lego Set", target: 150, allocated: 0 }];
const AUTO_REFRESH_MS = 5 * 60 * 1000;

// ── Hooks ─────────────────────────────────────────────────────

function useDisplayData() {
  const [snapshot, setSnapshot] = useState<{
    balance: StoredBalance | null;
    plan: PenniPlan | null;
  }>({ balance: null, plan: null });

  useEffect(() => {
    const read = () => {
      setSnapshot({
        balance: parseStoredBalance(
          localStorage.getItem(KEYS.balance) ?? sessionStorage.getItem(KEYS.balance)
        ),
        plan: parseStoredPlan(localStorage.getItem(KEYS.plan)),
      });
    };

    read();
    const interval = window.setInterval(read, 30_000);
    window.addEventListener("storage", read);
    window.addEventListener(BALANCE_UPDATED_EVENT, read);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", read);
      window.removeEventListener(BALANCE_UPDATED_EVENT, read);
    };
  }, []);

  return snapshot;
}

function useWakeLock() {
  const [state, setState] = useState<WakeLockState>("available");
  const [sentinel, setSentinel] = useState<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async () => {
    if (!window.isSecureContext) { setState("insecure"); return; }
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) { setState("unsupported"); return; }
    try {
      const lock = await wakeLock.request("screen");
      lock.addEventListener("release", () => setState("available"));
      setSentinel(lock);
      setState("active");
    } catch {
      setState("blocked");
    }
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && sentinel?.released) {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release();
    };
  }, [requestWakeLock, sentinel]);

  return { requestWakeLock, wakeLockState: state };
}

function useBankRefresh() {
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refreshBank = useCallback(async () => {
    setRefreshState("refreshing");
    try {
      const response = await fetch("/api/refresh-bank", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as RefreshBankResponse | null;

      if (!response.ok || !data?.balance) {
        setRefreshState(response.status === 401 ? "needs-connection" : "error");
        return;
      }

      writeBalance(data.balance);
      dispatchBalanceUpdated();
      setLastRefresh(new Date());
      setRefreshState("success");
    } catch {
      setRefreshState("error");
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshBank(), 2500);
    const interval = window.setInterval(() => void refreshBank(), AUTO_REFRESH_MS);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [refreshBank]);

  return { lastRefresh, refreshBank, refreshState };
}

function usePullToRefresh(onRefresh: () => void) {
  const [pullDistance, setPullDistance] = useState(0);
  const [startY, setStartY] = useState<number | null>(null);

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    if (window.scrollY <= 0) {
      setStartY(event.touches[0]?.clientY ?? null);
    }
  }, []);

  const onTouchMove = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      if (startY === null) return;
      const currentY = event.touches[0]?.clientY ?? startY;
      setPullDistance(Math.min(Math.max(0, currentY - startY), 110));
    },
    [startY]
  );

  const onTouchEnd = useCallback(() => {
    if (pullDistance >= 70) onRefresh();
    setStartY(null);
    setPullDistance(0);
  }, [onRefresh, pullDistance]);

  return {
    pullDistance,
    touchHandlers: { onTouchEnd, onTouchMove, onTouchStart },
  };
}

// ── Page ──────────────────────────────────────────────────────

export default function DisplayPage() {
  const { balance, plan } = useDisplayData();
  const { requestWakeLock, wakeLockState } = useWakeLock();
  const { lastRefresh, refreshBank, refreshState } = useBankRefresh();
  const { pullDistance, touchHandlers } = usePullToRefresh(refreshBank);

  const currency = balance?.currency ?? plan?.currency ?? "GBP";
  const pots = plan?.pots ?? { spend: 0, save: 0, give: 0 };
  const saveGoals = plan?.saveGoals?.length ? plan.saveGoals : DEFAULT_SAVE_GOALS;

  const displayGoals = saveGoals.map((goal, index) => {
    const fallbackAllocation = index === 0 ? pots.save : 0;
    const saved = roundMoney(goal.allocated ?? fallbackAllocation);
    const progress = Math.max(0, Math.min(100, (saved / goal.target) * 100));
    return { ...goal, saved, progress };
  });

  const balanceText = balance
    ? formatMoney(balance.amount, balance.currency)
    : formatMoney(0, currency);

  const statusText = (() => {
    if (refreshState === "refreshing")      return "Refreshing bank...";
    if (refreshState === "needs-connection") return "Reconnect bank";
    if (refreshState === "error")           return "Refresh failed";
    if (lastRefresh) return `Refreshed ${formatLastChecked(lastRefresh.toISOString())}`;
    return balance
      ? `Updated ${formatLastChecked(balance.updatedAt ?? balance.fetchedAt)}`
      : "Bank not connected";
  })();

  const wakeText = useMemo(() => {
    if (wakeLockState === "active")      return "Screen awake";
    if (wakeLockState === "insecure")    return "Needs HTTPS";
    if (wakeLockState === "unsupported") return "Use Android display settings";
    if (wakeLockState === "blocked")     return "Wake blocked";
    return "Keep awake";
  }, [wakeLockState]);

  return (
    <main className="display-page" {...touchHandlers}>
      {/* Pull-to-refresh indicator */}
      <div
        className={`display-refresh-cue ${pullDistance >= 70 ? "display-refresh-cue--ready" : ""}`}
        style={{ transform: `translateY(${Math.max(-46, pullDistance - 46)}px)` }}
        aria-hidden="true"
      >
        {pullDistance >= 70 ? "Release to refresh" : "Pull to refresh"}
      </div>

      <section className="display-screen" aria-labelledby="display-title">
        {/* Header */}
        <header className="display-header">
          <div>
            <p>Penni</p>
            <h1 id="display-title">Oinkbank</h1>
          </div>
        </header>

        {/* Balance */}
        <section className="display-balance" aria-live="polite">
          <span>{statusText}</span>
          <strong>{balanceText}</strong>
          <p>{balance?.accountName ?? "Ready for pocket money"}</p>
        </section>

        {/* Pots */}
        <section className="display-pots" aria-label="Money pots">
          <article className="display-pot display-pot--pink">
            <span>Spend</span>
            <strong>{formatMoney(pots.spend, currency)}</strong>
          </article>
          <article className="display-pot display-pot--green">
            <span>Save</span>
            <strong>{formatMoney(pots.save, currency)}</strong>
          </article>
          <article className="display-pot display-pot--gold">
            <span>Give</span>
            <strong>{formatMoney(pots.give, currency)}</strong>
          </article>
        </section>

        {/* Savings goals */}
        <section className="display-goal" aria-label="Savings goals">
          <div className="display-goal__heading">
            <span>Saving for</span>
            <strong>{formatMoney(pots.save, currency)}</strong>
          </div>
          <ul className="display-goal-list">
            {displayGoals.map((goal) => (
              <li key={goal.id}>
                <div className="display-goal-row">
                  <h2>{goal.name}</h2>
                  <strong>
                    {formatMoney(goal.saved, currency)} / {formatMoney(goal.target, currency)}
                  </strong>
                </div>
                <div
                  className="display-progress"
                  role="progressbar"
                  aria-label={`${goal.name} savings progress`}
                  aria-valuemin={0}
                  aria-valuemax={goal.target}
                  aria-valuenow={Math.min(goal.saved, goal.target)}
                >
                  <span style={{ width: `${goal.progress}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Footer controls */}
        <footer className="display-footer">
          <button
            className="display-button"
            type="button"
            onClick={() => void refreshBank()}
            disabled={refreshState === "refreshing"}
          >
            Refresh
          </button>
          <button
            className={`display-button display-button--secondary ${wakeLockState === "active" ? "display-button--active" : ""}`}
            type="button"
            onClick={() => void requestWakeLock()}
            disabled={wakeLockState === "active" || wakeLockState === "unsupported" || wakeLockState === "insecure"}
          >
            {wakeText}
          </button>
          <Link className="display-link" href="/settings">
            Setup
          </Link>
        </footer>
      </section>
    </main>
  );
}
