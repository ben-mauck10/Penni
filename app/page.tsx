"use client";

import { useMemo, useSyncExternalStore } from "react";

type StoredBalance = {
  amount: number;
  currency: string;
  accountName: string;
  updatedAt?: string;
  fetchedAt: string;
};

const storageKey = "penny-pig-balance";
const subscribe = () => () => {};
const goalName = "Lego Set";
const goalTarget = 150;

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

function getStoredBalanceSnapshot() {
  return sessionStorage.getItem(storageKey);
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

function formatDate(dateText?: string) {
  if (!dateText) {
    return null;
  }

  const date = new Date(dateText);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatLastChecked(dateText?: string) {
  if (!dateText) {
    return null;
  }

  const date = new Date(dateText);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  if (isToday) {
    return `today at ${time}`;
  }

  if (isYesterday) {
    return `yesterday at ${time}`;
  }

  return formatDate(dateText);
}

function getCheerMessage(amount?: number) {
  if (amount === undefined) {
    return "Your piggy bank is ready for its first coin.";
  }

  if (amount < 25) {
    return "A good start. Every coin counts.";
  }

  if (amount < 100) {
    return "Nice saving. You are building momentum.";
  }

  return "Amazing work. Your goal is getting close.";
}

function getSavedCopy(amount?: number) {
  if (amount === undefined) {
    return "Connect a bank account to begin.";
  }

  return `${Math.round(Math.min(100, (amount / goalTarget) * 100))}% of the way there`;
}

export default function HomePage() {
  const storedBalance = useSyncExternalStore(subscribe, getStoredBalanceSnapshot, () => null);
  const balance = useMemo(() => parseStoredBalance(storedBalance), [storedBalance]);
  const savedAmount = balance?.amount ?? 0;
  const goalProgress = Math.max(0, Math.min(100, (savedAmount / goalTarget) * 100));

  const balanceText = useMemo(() => {
    if (!balance) {
      return null;
    }

    return formatMoney(balance.amount, balance.currency);
  }, [balance]);

  const goalTargetText = formatMoney(goalTarget, balance?.currency ?? "GBP");
  const savedText = formatMoney(savedAmount, balance?.currency ?? "GBP");
  const lastCheckedText = formatLastChecked(balance?.updatedAt ?? balance?.fetchedAt);
  const cheerMessage = getCheerMessage(balance?.amount);

  return (
    <main className="home-page">
      <section className="home-intro" aria-labelledby="home-title">
        <div className="pig-mark pig-mark--large" aria-hidden="true">
          <span />
          <span />
        </div>
        <p className="eyebrow">Penny Pig</p>
        <h1 id="home-title">Penny Pig</h1>
        <p>See what is in your piggy bank, pick something exciting to save for, and keep going.</p>
        {!balance && (
          <a className="button-link" href="/api/auth-link">
            Connect bank
          </a>
        )}
      </section>

      {balance && (
      <div className="money-stack">
        <section className="balance-card" aria-live="polite">
          <div className="balance-header">
            <div>
              <p className="eyebrow">Your Piggy Bank</p>
              <h2>{balanceText}</h2>
            </div>
            <span className="coin-spark" aria-hidden="true">
              *
            </span>
          </div>

          <p className="magic-message">{cheerMessage}</p>

          <div className="trust-row">
            {balance && <span>Linked bank balance</span>}
            {lastCheckedText && <span>Checked {lastCheckedText}</span>}
            {balance && <span>Synced with TrueLayer</span>}
          </div>

          <div className="balance-actions">
            <a className="button-link button-link--secondary" href="/api/auth-link">
              Refresh balance
            </a>
          </div>
        </section>

        <section className="goal-card" aria-labelledby="goal-title">
          <div className="goal-heading">
            <div>
              <p className="eyebrow">Savings Goal</p>
              <h3 id="goal-title">{goalName}</h3>
            </div>
            <span className="goal-target">{goalTargetText}</span>
          </div>

          <div
            className="progress-track"
            role="progressbar"
            aria-label={`${goalName} savings progress`}
            aria-valuemin={0}
            aria-valuemax={goalTarget}
            aria-valuenow={Math.min(savedAmount, goalTarget)}
          >
            <span style={{ width: `${goalProgress}%` }} />
          </div>

          <div className="goal-footer">
            <p>{getSavedCopy(balance?.amount)}</p>
            <strong>{savedText} saved</strong>
          </div>
          <p className="goal-note">You are getting closer.</p>
        </section>
      </div>
      )}
    </main>
  );
}
