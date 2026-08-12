"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import SplitPrompt, { POT_META } from "./components/SplitPrompt";
import {
  formatMoney,
  formatLastChecked,
  getCheerMessage,
  roundMoney,
  splitAmount,
  deductFromPot,
} from "../lib/money";
import {
  appendHistory,
  createPlanFromBalance,
  getBalanceServerSnapshot,
  getBalanceSnapshot,
  parseStoredBalance,
  readOrCreatePlan,
  reconcileSaveGoals,
  readSplit,
  subscribeToBalance,
  writePlan,
  writeSplit,
} from "../lib/storage";
import type { PenniPlan, PenniSplit } from "../lib/types";

export default function HomePage() {
  const storedBalanceJson = useSyncExternalStore(
    subscribeToBalance,
    getBalanceSnapshot,
    getBalanceServerSnapshot
  );
  const balance = parseStoredBalance(storedBalanceJson);
  const [plan, setPlan] = useState<PenniPlan | null>(null);

  // Read plan from localStorage after mount to avoid hydration mismatch.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPlan(readOrCreatePlan());
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  // If the balance currency changed, reset the plan.
  const activePlan =
    balance && plan && plan.currency !== balance.currency
      ? createPlanFromBalance(balance)
      : plan;

  const currency = balance?.currency ?? activePlan?.currency ?? "GBP";
  const pots = activePlan?.pots ?? { spend: 0, save: 0, give: 0 };
  const saveGoals = activePlan?.saveGoals ?? [];

  const balanceDelta =
    balance && activePlan ? roundMoney(balance.amount - activePlan.lastBalanceAmount) : 0;
  const pendingIncoming = balanceDelta > 0.009 ? balanceDelta : 0;
  const pendingOutgoing = balanceDelta < -0.009 ? Math.abs(balanceDelta) : 0;

  const balanceText = balance
    ? formatMoney(balance.amount, balance.currency)
    : formatMoney(0, currency);

  // Scale font size down for longer balance strings to prevent wrapping.
  const balanceFontSize = (() => {
    const len = balanceText.length;
    if (len <= 6)  return "clamp(2.8rem, 12vw, 4rem)";
    if (len <= 8)  return "clamp(2.2rem, 9vw, 3.25rem)";
    if (len <= 10) return "clamp(1.8rem, 7.5vw, 2.75rem)";
    return "clamp(1.5rem, 6vw, 2.25rem)";
  })();
  const lastCheckedText = formatLastChecked(balance?.updatedAt ?? balance?.fetchedAt);

  let statusText = lastCheckedText;
  let nudgeText = "Your bank balance is split into meaning.";
  if (!balance) {
    statusText = "Bank not connected";
  } else if (pendingIncoming) {
    statusText = `${formatMoney(pendingIncoming, currency)} new money`;
    nudgeText = `Split ${formatMoney(pendingIncoming, currency)} into your Penni plan.`;
  } else if (pendingOutgoing) {
    statusText = `${formatMoney(pendingOutgoing, currency)} spent`;
    nudgeText = `Choose which pot paid for ${formatMoney(pendingOutgoing, currency)}.`;
  }

  const updatePlan = useCallback((nextPlan: PenniPlan) => {
    writePlan(nextPlan);
    setPlan(nextPlan);
  }, []);

  const handleConfirmSplit = (newPots: PenniSplit) => {
    if (!balance || !activePlan) return;
    const total = pendingIncoming;
    if (total > 0) {
      writeSplit({
        spend: roundMoney(newPots.spend / total),
        save: roundMoney(newPots.save / total),
        give: roundMoney(newPots.give / total),
      });
    }
    updatePlan(
      reconcileSaveGoals({
        ...activePlan,
        lastBalanceAmount: balance.amount,
        pots: {
          spend: roundMoney(pots.spend + newPots.spend),
          save: roundMoney(pots.save + newPots.save),
          give: roundMoney(pots.give + newPots.give),
        },
      })
    );
    appendHistory({
      id: crypto.randomUUID(),
      kind: "incoming",
      amount: pendingIncoming,
      currency,
      pots: newPots,
      recordedAt: new Date().toISOString(),
    });
  };

  const handleSpendFromPot = (pot: keyof PenniPlan["pots"]) => {
    if (!balance || !activePlan || !pendingOutgoing) return;
    const nextPots = deductFromPot(pots, pot, pendingOutgoing);
    const potDelta: PenniSplit = {
      spend: roundMoney(pots.spend - nextPots.spend),
      save: roundMoney(pots.save - nextPots.save),
      give: roundMoney(pots.give - nextPots.give),
    };
    updatePlan(
      reconcileSaveGoals({
        ...activePlan,
        lastBalanceAmount: balance.amount,
        pots: nextPots,
      })
    );
    appendHistory({
      id: crypto.randomUUID(),
      kind: "outgoing",
      amount: pendingOutgoing,
      currency,
      pots: potDelta,
      recordedAt: new Date().toISOString(),
    });
  };

  const jarRows = [
    { name: "Spend", value: pots.spend, tone: "pink",  helper: "money for now" },
    { name: "Save",  value: pots.save,  tone: "green", helper: "money for goals" },
    { name: "Give",  value: pots.give,  tone: "gold",  helper: "money to share" },
  ];

  return (
    <main className="home-page">
      <div className="home-shell">
        {/* Header */}
        <header className="home-header">
          <div className="home-brand">
            <Image
              className="home-pig"
              src="/penni-oinkbank.png"
              alt=""
              width={1229}
              height={820}
              priority
            />
            <div>
              <p>Penni</p>
              <h1 id="screen-title">Oinkbank</h1>
            </div>
          </div>
          <nav className="home-nav" aria-label="App navigation">
            <Link href="/display">Display</Link>
            <Link href="/history">History</Link>
            <Link href="/settings">Setup</Link>
          </nav>
        </header>

        {/* Balance */}
        <section className="home-balance" aria-live="polite" aria-labelledby="screen-title">
          <span>{statusText}</span>
          <strong style={{ fontSize: balanceFontSize }}>{balanceText}</strong>
          <p>
            {balance
              ? getCheerMessage(balance.amount)
              : "Connect a bank account, or use phone test mode."}
          </p>
        </section>

        {/* Incoming: show split prompt */}
        {pendingIncoming ? (
          <section className="home-panel home-panel--action">
            <div className="home-panel__heading">
              <span>Money in</span>
              <strong>{formatMoney(pendingIncoming, currency)}</strong>
            </div>
            <SplitPrompt
              total={pendingIncoming}
              currency={currency}
              initial={splitAmount(pendingIncoming, readSplit())}
              onConfirm={handleConfirmSplit}
            />
          </section>
        ) : (
          <>
            {/* Pots */}
            <section className="home-pots" aria-label="Money pots">
              {jarRows.map((jar) => (
                <article className={`home-pot home-pot--${jar.tone}`} key={jar.name}>
                  <div>
                    <span>{jar.name}</span>
                    <p>{jar.helper}</p>
                  </div>
                  <strong>{formatMoney(jar.value, currency)}</strong>
                </article>
              ))}
            </section>

            {/* Savings goals */}
            <section className="home-panel" aria-label="Savings goals">
              <div className="home-panel__heading">
                <span>Saving for</span>
                <strong>{formatMoney(pots.save, currency)}</strong>
              </div>
              <ul className="home-goals">
                {saveGoals.map((goal) => {
                  const allocated = goal.allocated ?? 0;
                  const progress = Math.max(0, Math.min(100, (allocated / goal.target) * 100));
                  return (
                    <li key={goal.id}>
                      <div className="home-goal-row">
                        <span>{goal.name}</span>
                        <strong>
                          {formatMoney(allocated, currency)} / {formatMoney(goal.target, currency)}
                        </strong>
                      </div>
                      <div
                        className="home-progress"
                        role="progressbar"
                        aria-label={`${goal.name} savings progress`}
                        aria-valuemin={0}
                        aria-valuemax={goal.target}
                        aria-valuenow={Math.min(allocated, goal.target)}
                      >
                        <span style={{ width: `${progress}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Outgoing: choose pot */}
            {pendingOutgoing ? (
              <section className="home-panel home-panel--action">
                <div className="home-panel__heading">
                  <span>Money spent</span>
                  <strong>{formatMoney(pendingOutgoing, currency)}</strong>
                </div>
                <p>{nudgeText}</p>
                <div className="home-choice-grid" aria-label="Choose pot used for spending">
                  {POT_META.map((pot) => (
                    <button
                      className={`home-button home-button--${pot.tone}`}
                      key={pot.key}
                      type="button"
                      onClick={() => handleSpendFromPot(pot.key)}
                    >
                      {pot.label}
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <section className="home-actions">
                <Link className="home-button home-button--primary" href="/api/auth-link">
                  {balance ? "Re-link bank" : "Link bank account"}
                </Link>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
