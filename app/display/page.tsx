"use client";

import Image from "next/image";
import Link from "next/link";
import { type TouchEvent, useCallback, useEffect, useMemo, useState } from "react";

type StoredBalance = {
  amount: number;
  currency: string;
  accountName: string;
  updatedAt?: string;
  fetchedAt: string;
};

type SaveGoal = {
  id: string;
  name: string;
  target: number;
  allocated?: number;
};

type PenniPlan = {
  currency: string;
  lastBalanceAmount: number;
  pots: {
    spend: number;
    save: number;
    give: number;
  };
  saveGoals: SaveGoal[];
};

type WakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinel>;
  };
};

type WakeLockState = "unsupported" | "insecure" | "available" | "active" | "blocked";
type RefreshState = "idle" | "refreshing" | "success" | "needs-connection" | "error";
type RefreshBankResponse = {
  balance?: StoredBalance;
  error?: string;
};

const balanceStorageKey = "penny-pig-balance";
const planStorageKey = "penni-plan";
const balanceUpdatedEvent = "penni-balance-updated";
const autoRefreshMs = 5 * 60 * 1000;
const defaultSaveGoals: SaveGoal[] = [{ id: "default", name: "Lego Set", target: 150 }];

function roundMoney(amount: number) {
  return Math.round(amount * 100) / 100;
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function parseStoredBalance(stored: string | null) {
  try {
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as Partial<StoredBalance>;

    if (typeof parsed.amount !== "number" || !parsed.currency) {
      return null;
    }

    return {
      amount: parsed.amount,
      currency: parsed.currency,
      accountName: parsed.accountName ?? "First account",
      updatedAt: parsed.updatedAt,
      fetchedAt: parsed.fetchedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function parseStoredPlan(stored: string | null) {
  try {
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as Partial<PenniPlan>;

    if (
      !parsed.currency ||
      typeof parsed.lastBalanceAmount !== "number" ||
      typeof parsed.pots?.spend !== "number" ||
      typeof parsed.pots.save !== "number" ||
      typeof parsed.pots.give !== "number"
    ) {
      return null;
    }

    const saveGoals =
      Array.isArray(parsed.saveGoals) && parsed.saveGoals.length > 0
        ? parsed.saveGoals.filter(
            (goal) => goal && typeof goal.name === "string" && typeof goal.target === "number"
          )
        : defaultSaveGoals;

    return {
      currency: parsed.currency,
      lastBalanceAmount: parsed.lastBalanceAmount,
      pots: parsed.pots,
      saveGoals,
    };
  } catch {
    return null;
  }
}

function formatLastChecked(dateText?: string) {
  if (!dateText) {
    return "Waiting for bank";
  }

  const date = new Date(dateText);

  if (Number.isNaN(date.getTime())) {
    return "Linked";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function useDisplayData() {
  const [snapshot, setSnapshot] = useState<{ balance: StoredBalance | null; plan: PenniPlan | null }>(() => ({
    balance: null,
    plan: null,
  }));

  useEffect(() => {
    const read = () => {
      setSnapshot({
        balance: parseStoredBalance(localStorage.getItem(balanceStorageKey)),
        plan: parseStoredPlan(localStorage.getItem(planStorageKey)),
      });
    };

    read();
    const interval = window.setInterval(read, 30000);
    window.addEventListener("storage", read);
    window.addEventListener(balanceUpdatedEvent, read);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", read);
      window.removeEventListener(balanceUpdatedEvent, read);
    };
  }, []);

  return snapshot;
}

function useWakeLock() {
  const [state, setState] = useState<WakeLockState>(() => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      return "insecure";
    }

    if (typeof navigator !== "undefined" && !("wakeLock" in navigator)) {
      return "unsupported";
    }

    return "available";
  });
  const [sentinel, setSentinel] = useState<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async () => {
    if (!window.isSecureContext) {
      setState("insecure");
      return;
    }

    const wakeLock = (navigator as WakeLockNavigator).wakeLock;

    if (!wakeLock) {
      setState("unsupported");
      return;
    }

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

      localStorage.setItem(balanceStorageKey, JSON.stringify(data.balance));
      sessionStorage.setItem(balanceStorageKey, JSON.stringify(data.balance));
      window.dispatchEvent(new Event(balanceUpdatedEvent));
      setLastRefresh(new Date());
      setRefreshState("success");
    } catch {
      setRefreshState("error");
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshBank();
    }, 2500);
    const interval = window.setInterval(() => {
      void refreshBank();
    }, autoRefreshMs);

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
      if (startY === null) {
        return;
      }

      const currentY = event.touches[0]?.clientY ?? startY;
      const distance = Math.max(0, currentY - startY);
      setPullDistance(Math.min(distance, 110));
    },
    [startY]
  );

  const onTouchEnd = useCallback(() => {
    if (pullDistance >= 70) {
      onRefresh();
    }

    setStartY(null);
    setPullDistance(0);
  }, [onRefresh, pullDistance]);

  return {
    pullDistance,
    touchHandlers: {
      onTouchEnd,
      onTouchMove,
      onTouchStart,
    },
  };
}

export default function DisplayPage() {
  const { balance, plan } = useDisplayData();
  const { requestWakeLock, wakeLockState } = useWakeLock();
  const { lastRefresh, refreshBank, refreshState } = useBankRefresh();
  const { pullDistance, touchHandlers } = usePullToRefresh(refreshBank);
  const currency = balance?.currency ?? plan?.currency ?? "GBP";
  const pots = plan?.pots ?? { spend: 0, save: 0, give: 0 };
  const mainGoal = plan?.saveGoals[0] ?? defaultSaveGoals[0];
  const saved = roundMoney(mainGoal.allocated ?? pots.save);
  const progress = Math.max(0, Math.min(100, (saved / mainGoal.target) * 100));
  const balanceText = balance ? formatMoney(balance.amount, balance.currency) : formatMoney(0, currency);
  const statusText = (() => {
    if (refreshState === "refreshing") return "Refreshing bank...";
    if (refreshState === "needs-connection") return "Reconnect bank";
    if (refreshState === "error") return "Refresh failed";
    if (lastRefresh) return `Refreshed ${formatLastChecked(lastRefresh.toISOString())}`;
    return balance ? `Updated ${formatLastChecked(balance.updatedAt ?? balance.fetchedAt)}` : "Bank not connected";
  })();
  const wakeText = useMemo(() => {
    if (wakeLockState === "active") return "Screen awake";
    if (wakeLockState === "insecure") return "Needs HTTPS";
    if (wakeLockState === "unsupported") return "Use Android display settings";
    if (wakeLockState === "blocked") return "Wake blocked";
    return "Keep awake";
  }, [wakeLockState]);

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
        <header className="display-header">
          <div>
            <p>Penni</p>
            <h1 id="display-title">Oinkbank</h1>
          </div>
          <Image
            className="display-pig"
            src="/penni-oinkbank.png"
            alt=""
            width={1229}
            height={820}
            priority
          />
        </header>

        <section className="display-balance" aria-live="polite">
          <span>{statusText}</span>
          <strong>{balanceText}</strong>
          <p>{balance?.accountName ?? "Ready for pocket money"}</p>
        </section>

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

        <section className="display-goal" aria-label="Savings goal">
          <div>
            <span>Saving for</span>
            <h2>{mainGoal.name}</h2>
          </div>
          <strong>{formatMoney(saved, currency)} / {formatMoney(mainGoal.target, currency)}</strong>
          <div
            className="display-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={mainGoal.target}
            aria-valuenow={Math.min(saved, mainGoal.target)}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        </section>

        <footer className="display-footer">
          <button
            className="display-button display-button--secondary"
            type="button"
            disabled={refreshState === "refreshing"}
            onClick={refreshBank}
          >
            {refreshState === "refreshing" ? "Refreshing" : "Refresh"}
          </button>
          <button
            className="display-button"
            type="button"
            disabled={wakeLockState === "active" || wakeLockState === "unsupported" || wakeLockState === "insecure"}
            onClick={requestWakeLock}
            title={
              wakeLockState === "insecure"
                ? "Android Chrome only allows Wake Lock on HTTPS or localhost."
                : undefined
            }
          >
            {wakeText}
          </button>
          <Link className="display-link" href="/">
            Setup
          </Link>
        </footer>
      </section>
    </main>
  );
}
