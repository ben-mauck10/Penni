"use client";

import Link from "next/link";
import { type TouchEvent, useCallback, useEffect, useState } from "react";
import { formatLastChecked, formatMoney, roundMoney } from "../../lib/money";
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

type RefreshState = "idle" | "refreshing" | "success" | "needs-connection" | "error";

type WakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

type RefreshBankResponse = { balance?: StoredBalance; error?: string };

const AUTO_REFRESH_MS = 5 * 60 * 1000;

// ── Hooks ─────────────────────────────────────────────────────

function useDisplayData() {
  const [data, setData] = useState<{ balance: StoredBalance | null; plan: PenniPlan | null }>({
    balance: null,
    plan: null,
  });

  useEffect(() => {
    const read = () => {
      setData({
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

  return data;
}

function useBankRefresh() {
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refreshBank = useCallback(async () => {
    setRefreshState("refreshing");
    try {
      const response = await fetch("/api/refresh-bank", { method: "POST", cache: "no-store" });
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
    return () => { window.clearTimeout(timeout); window.clearInterval(interval); };
  }, [refreshBank]);

  return { lastRefresh, refreshBank, refreshState };
}

function usePullToRefresh(onRefresh: () => void) {
  const [pullDistance, setPullDistance] = useState(0);
  const [startY, setStartY] = useState<number | null>(null);

  const onTouchStart = useCallback((e: TouchEvent<HTMLElement>) => {
    if (window.scrollY <= 0) setStartY(e.touches[0]?.clientY ?? null);
  }, []);
  const onTouchMove = useCallback((e: TouchEvent<HTMLElement>) => {
    if (startY === null) return;
    setPullDistance(Math.min(Math.max(0, (e.touches[0]?.clientY ?? startY) - startY), 110));
  }, [startY]);
  const onTouchEnd = useCallback(() => {
    if (pullDistance >= 70) onRefresh();
    setStartY(null);
    setPullDistance(0);
  }, [onRefresh, pullDistance]);

  return { pullDistance, touchHandlers: { onTouchStart, onTouchMove, onTouchEnd } };
}

function useWakeLock() {
  const [active, setActive] = useState(false);
  const [sentinel, setSentinel] = useState<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async () => {
    if (!window.isSecureContext) return;
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) return;
    try {
      const lock = await wakeLock.request("screen");
      lock.addEventListener("release", () => setActive(false));
      setSentinel(lock);
      setActive(true);
    } catch { /* blocked */ }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && sentinel?.released) void requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); void sentinel?.release(); };
  }, [requestWakeLock, sentinel]);

  return { requestWakeLock, wakeLockActive: active };
}

// ── Page ──────────────────────────────────────────────────────

export default function DisplayPage() {
  const { balance, plan } = useDisplayData();
  const { lastRefresh, refreshBank, refreshState } = useBankRefresh();
  const { pullDistance, touchHandlers } = usePullToRefresh(refreshBank);
  const { requestWakeLock, wakeLockActive } = useWakeLock();

  const currency = balance?.currency ?? plan?.currency ?? "GBP";
  const saveGoals = plan?.saveGoals ?? [];
  const savePot = plan?.pots.save ?? 0;

  const goals = saveGoals.map((goal) => {
    const saved = roundMoney(goal.allocated ?? 0);
    const progress = goal.target > 0 ? Math.max(0, Math.min(100, (saved / goal.target) * 100)) : 0;
    return { ...goal, saved, progress };
  });

  const balanceText = balance ? formatMoney(balance.amount, currency) : "–";

  const statusText = (() => {
    if (refreshState === "refreshing")       return "Refreshing...";
    if (refreshState === "needs-connection") return "Reconnect bank";
    if (refreshState === "error")            return "Refresh failed";
    if (lastRefresh) return `Updated ${formatLastChecked(lastRefresh.toISOString())}`;
    return balance
      ? `Updated ${formatLastChecked(balance.updatedAt ?? balance.fetchedAt)}`
      : "Waiting for bank";
  })();

  // Scale font down for longer amounts (e.g. £1,403.81)
  const balanceFontSize = (() => {
    const len = balanceText.length;
    if (len <= 5)  return "clamp(4rem, 18vw, 7rem)";
    if (len <= 7)  return "clamp(3rem, 14vw, 6rem)";
    if (len <= 9)  return "clamp(2.4rem, 11vw, 5rem)";
    return "clamp(2rem, 9vw, 4rem)";
  })();

  return (
    <main className="display-page" {...touchHandlers}>
      <div
        className={`display-refresh-cue ${pullDistance >= 70 ? "display-refresh-cue--ready" : ""}`}
        style={{ transform: `translateY(${Math.max(-46, pullDistance - 46)}px)` }}
        aria-hidden="true"
      >
        {pullDistance >= 70 ? "Release to refresh" : "Pull to refresh"}
      </div>

      <section className="display-screen" aria-labelledby="display-title">

        {/* Balance — the hero */}
        <div className="display-balance" aria-live="polite">
          <span className="display-balance__status">{statusText}</span>
          <strong className="display-balance__amount" style={{ fontSize: balanceFontSize }}>
            {balanceText}
          </strong>
          <span className="display-balance__account">
            {balance?.accountName ?? "Penni Oinkbank"}
          </span>
        </div>

        {/* Goals */}
        {goals.length > 0 ? (
          <div className="display-goals">
            <p className="display-goals__label">Saving for</p>
            <ul className="display-goals__list">
              {goals.map((goal) => (
                <li key={goal.id} className="display-goal-item">
                  <div className="display-goal-item__row">
                    <span className="display-goal-item__name">{goal.name}</span>
                    <span className="display-goal-item__amount">
                      {formatMoney(goal.saved, currency)}
                      <em> / {formatMoney(goal.target, currency)}</em>
                    </span>
                  </div>
                  <div
                    className="display-goal-item__bar"
                    role="progressbar"
                    aria-label={`${goal.name} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(goal.progress)}
                  >
                    <span style={{ width: `${goal.progress}%` }} />
                  </div>
                  <span className="display-goal-item__pct">{Math.round(goal.progress)}%</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="display-goals display-goals--empty">
            <p>No goals yet — set them up in the parent app.</p>
          </div>
        )}

        {/* Footer controls */}
        <footer className="display-footer">
          <button
            className="display-footer__btn"
            type="button"
            onClick={() => void refreshBank()}
            disabled={refreshState === "refreshing"}
          >
            {refreshState === "refreshing" ? "Refreshing…" : "Refresh"}
          </button>
          <button
            className={`display-footer__btn display-footer__btn--secondary ${wakeLockActive ? "display-footer__btn--active" : ""}`}
            type="button"
            onClick={() => void requestWakeLock()}
            disabled={wakeLockActive}
          >
            {wakeLockActive ? "Screen awake ✓" : "Keep awake"}
          </button>
          <Link className="display-footer__link" href="/">
            Parent app
          </Link>
        </footer>
      </section>
    </main>
  );
}
