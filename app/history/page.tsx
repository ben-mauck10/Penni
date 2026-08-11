"use client";

import Link from "next/link";
import { useState } from "react";
import { formatMoney } from "../../lib/money";
import { readHistory } from "../../lib/storage";
import type { HistoryEntry, PenniSplit } from "../../lib/types";

// ── Helpers ───────────────────────────────────────────────────

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatDateHeading(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "Unknown date";
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString())       return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function groupByDate(entries: HistoryEntry[]) {
  const groups: { dateKey: string; label: string; entries: HistoryEntry[] }[] = [];
  const seen = new Map<string, number>();

  for (const entry of entries) {
    const date = new Date(entry.recordedAt);
    const dateKey = isNaN(date.getTime()) ? "unknown" : date.toDateString();
    const idx = seen.get(dateKey);
    if (idx !== undefined) {
      groups[idx].entries.push(entry);
    } else {
      seen.set(dateKey, groups.length);
      groups.push({ dateKey, label: formatDateHeading(entry.recordedAt), entries: [entry] });
    }
  }

  return groups;
}

// ── Sub-components ────────────────────────────────────────────

type PotChipProps = {
  label: string;
  amount: number;
  currency: string;
  tone: "pink" | "green" | "gold";
  kind: "incoming" | "outgoing";
};

function PotChip({ label, amount, currency, tone, kind }: PotChipProps) {
  if (amount === 0) return null;
  const sign = kind === "incoming" ? "+" : "−";
  return (
    <span className={`history-pot-chip history-pot-chip--${tone}`}>
      {label} {sign}{formatMoney(amount, currency)}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function HistoryPage() {
  // useState initializer runs once on mount — safe to call readHistory() here.
  const [entries] = useState<HistoryEntry[]>(readHistory);
  const groups = groupByDate(entries);

  return (
    <main className="history-page">
      <div className="history-panel">
        <header className="settings-header">
          <div>
            <p className="eyebrow">Penni Oinkbank</p>
            <h1>History</h1>
          </div>
          <Link className="settings-back" href="/" aria-label="Back to home">
            ← Home
          </Link>
        </header>

        {entries.length === 0 ? (
          <div className="history-empty">
            <div className="pig-mark pig-mark--large" aria-hidden="true">
              <span />
              <span />
            </div>
            <p>No actions yet. Split some money to see it here.</p>
          </div>
        ) : (
          <ol className="history-list" aria-label="Transaction history">
            {groups.map((group) => (
              <li key={group.dateKey} className="history-group">
                <h2 className="history-date-heading">{group.label}</h2>
                <ol className="history-group-entries">
                  {group.entries.map((entry) => {
                    const pots = entry.pots as PenniSplit;
                    return (
                      <li key={entry.id} className={`history-entry history-entry--${entry.kind}`}>
                        <div className="history-entry-top">
                          <div className="history-entry-main">
                            <span className="history-entry-kind">
                              {entry.kind === "incoming" ? "Money in" : "Money spent"}
                            </span>
                            <strong className="history-entry-amount">
                              {entry.kind === "incoming" ? "+" : "−"}
                              {formatMoney(entry.amount, entry.currency)}
                            </strong>
                          </div>
                          <time className="history-entry-time" dateTime={entry.recordedAt}>
                            {formatTime(entry.recordedAt)}
                          </time>
                        </div>
                        <div className="history-pot-chips" aria-label="Pot breakdown">
                          <PotChip label="Spend" amount={Math.abs(pots.spend)} currency={entry.currency} tone="pink"  kind={entry.kind} />
                          <PotChip label="Save"  amount={Math.abs(pots.save)}  currency={entry.currency} tone="green" kind={entry.kind} />
                          <PotChip label="Give"  amount={Math.abs(pots.give)}  currency={entry.currency} tone="gold"  kind={entry.kind} />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
