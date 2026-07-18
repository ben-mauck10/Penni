"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useSyncExternalStore, useCallback } from "react";

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

const balanceStorageKey = "penny-pig-balance";
const planStorageKey = "penni-plan";
const splitStorageKey = "penni-split";
const historyStorageKey = "penni-history";
const maxHistoryEntries = 50;

type HistoryEntry = {
  id: string;
  kind: "incoming" | "outgoing";
  amount: number;
  currency: string;
  pots: { spend: number; save: number; give: number };
  recordedAt: string;
};

function appendHistory(entry: HistoryEntry) {
  try {
    const stored = localStorage.getItem(historyStorageKey);
    const existing: HistoryEntry[] = stored ? (JSON.parse(stored) as HistoryEntry[]) : [];
    const next = [entry, ...existing].slice(0, maxHistoryEntries);
    localStorage.setItem(historyStorageKey, JSON.stringify(next));
  } catch {
    // non-critical, ignore
  }
}
const defaultGoalName = "Lego Set";
const defaultGoalTarget = 150;
const defaultSaveGoals: SaveGoal[] = [{ id: "default", name: defaultGoalName, target: defaultGoalTarget }];
const defaultSplit = {
  spend: 0.4,
  save: 0.5,
  give: 0.1,
};
const subscribe = () => () => {};

function roundMoney(amount: number) {
  return Math.round(amount * 100) / 100;
}

function splitAmount(amount: number, split: { spend: number; save: number; give: number }) {
  const spend = roundMoney(amount * split.spend);
  const save = roundMoney(amount * split.save);
  const give = roundMoney(amount - spend - save);

  return { spend, save, give };
}

function allocateSaveGoals(goals: SaveGoal[], savePot: number) {
  let remaining = roundMoney(savePot);

  return goals.map((goal) => {
    const allocated = roundMoney(Math.min(goal.target, Math.max(0, remaining)));
    remaining = roundMoney(remaining - allocated);

    return { ...goal, allocated };
  });
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

    const parsed = JSON.parse(stored) as Partial<PenniPlan> & {
      saveGoal?: { name?: string; target?: number };
    };

    if (
      !parsed.currency ||
      typeof parsed.lastBalanceAmount !== "number" ||
      typeof parsed.pots?.spend !== "number" ||
      typeof parsed.pots.save !== "number" ||
      typeof parsed.pots.give !== "number"
    ) {
      return null;
    }

    // Migrate old single saveGoal → saveGoals array
    let saveGoals: SaveGoal[];
    if (Array.isArray(parsed.saveGoals) && parsed.saveGoals.length > 0) {
      saveGoals = parsed.saveGoals
        .filter((g) => g && typeof g.name === "string" && typeof g.target === "number")
        .map((g) => ({
          id: typeof g.id === "string" ? g.id : crypto.randomUUID(),
          name: g.name,
          target: g.target,
          allocated: typeof g.allocated === "number" ? g.allocated : undefined,
        }));
    } else if (parsed.saveGoal?.name && typeof parsed.saveGoal.target === "number") {
      saveGoals = [
        { id: "migrated", name: parsed.saveGoal.name, target: parsed.saveGoal.target },
      ];
    } else {
      saveGoals = defaultSaveGoals;
    }

    if (saveGoals.length === 0) saveGoals = defaultSaveGoals;

    return {
      currency: parsed.currency,
      lastBalanceAmount: parsed.lastBalanceAmount,
      pots: {
        spend: parsed.pots.spend,
        save: parsed.pots.save,
        give: parsed.pots.give,
      },
      saveGoals,
    };
  } catch {
    return null;
  }
}

function getStoredBalanceSnapshot() {
  const localBalance = localStorage.getItem(balanceStorageKey);

  if (localBalance) {
    return localBalance;
  }

  const sessionBalance = sessionStorage.getItem(balanceStorageKey);

  if (sessionBalance) {
    localStorage.setItem(balanceStorageKey, sessionBalance);
  }

  return sessionBalance;
}

function getInitialPlan() {
  if (typeof window === "undefined") {
    return null;
  }

  return parseStoredPlan(localStorage.getItem(planStorageKey));
}

function getStoredSplit() {
  try {
    const stored = localStorage.getItem(splitStorageKey);
    if (!stored) return defaultSplit;
    const parsed = JSON.parse(stored) as Partial<typeof defaultSplit>;
    if (
      typeof parsed.spend !== "number" ||
      typeof parsed.save !== "number" ||
      typeof parsed.give !== "number"
    ) {
      return defaultSplit;
    }
    return parsed as typeof defaultSplit;
  } catch {
    return defaultSplit;
  }
}

function createPlanFromBalance(balance: StoredBalance): PenniPlan {
  const split = getStoredSplit();
  const pots = splitAmount(balance.amount, split);

  return {
    currency: balance.currency,
    lastBalanceAmount: balance.amount,
    pots,
    saveGoals: allocateSaveGoals(defaultSaveGoals, pots.save),
  };
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

function formatLastChecked(dateText?: string) {
  if (!dateText) {
    return "Not linked yet";
  }

  const date = new Date(dateText);

  if (Number.isNaN(date.getTime())) {
    return "Linked";
  }

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  if (isToday) {
    return `Updated ${time}`;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function getCheerMessage(amount?: number) {
  if (amount === undefined) {
    return "Ready for the first coin.";
  }

  if (amount < 25) {
    return "Every coin counts.";
  }

  if (amount < 100) {
    return "You are building momentum.";
  }

  return "Your goal is getting close.";
}

function deductFromPot(plan: PenniPlan, pot: keyof PenniPlan["pots"], amount: number) {
  const nextPots = { ...plan.pots };
  let remaining = roundMoney(amount);
  const fromSelected = Math.min(nextPots[pot], remaining);
  nextPots[pot] = roundMoney(nextPots[pot] - fromSelected);
  remaining = roundMoney(remaining - fromSelected);

  for (const key of ["spend", "save", "give"] as const) {
    if (remaining <= 0 || key === pot) {
      continue;
    }

    const fromPot = Math.min(nextPots[key], remaining);
    nextPots[key] = roundMoney(nextPots[key] - fromPot);
    remaining = roundMoney(remaining - fromPot);
  }

  return nextPots;
}

function reconcileSaveGoals(plan: PenniPlan) {
  return {
    ...plan,
    saveGoals: allocateSaveGoals(plan.saveGoals, plan.pots.save),
  };
}

// ── Split prompt ────────────────────────────────────────────

type SplitValues = { spend: number; save: number; give: number };

const POT_META = [
  { key: "spend" as const, label: "Spend", hint: "everyday spending", tone: "pink" },
  { key: "save" as const,  label: "Save",  hint: "towards goals",     tone: "green" },
  { key: "give" as const,  label: "Give",  hint: "sharing & giving",  tone: "gold" },
];

function SplitPrompt({
  total,
  currency,
  initial,
  onConfirm,
}: {
  total: number;
  currency: string;
  initial: SplitValues;
  onConfirm: (values: SplitValues) => void;
}) {
  const [values, setValues] = useState<SplitValues>(initial);

  const remainder = roundMoney(total - values.spend - values.save - values.give);
  const isBalanced = Math.abs(remainder) < 0.005;

  // When one slider moves, scale the other two proportionally to fill the total.
  const handleSlider = useCallback(
    (changed: keyof SplitValues, raw: number) => {
      const newVal = Math.min(raw, total);
      const others = POT_META.map((p) => p.key).filter((k) => k !== changed) as (keyof SplitValues)[];
      const otherSum = values[others[0]] + values[others[1]];
      const remaining = roundMoney(total - newVal);

      let a: number;
      let b: number;
      if (otherSum <= 0) {
        a = roundMoney(remaining / 2);
        b = roundMoney(remaining - a);
      } else {
        const ratio = values[others[0]] / otherSum;
        a = roundMoney(remaining * ratio);
        b = roundMoney(remaining - a);
      }

      setValues({
        ...values,
        [changed]: newVal,
        [others[0]]: a,
        [others[1]]: b,
      });
    },
    [values, total]
  );

  // When a number input changes, just update that field directly.
  const handleInput = useCallback(
    (changed: keyof SplitValues, raw: string) => {
      const parsed = parseFloat(raw);
      setValues((prev) => ({
        ...prev,
        [changed]: isNaN(parsed) ? 0 : Math.max(0, roundMoney(parsed)),
      }));
    },
    []
  );

  return (
    <div className="split-prompt" aria-label="Split incoming money">
      <p className="split-prompt__heading">
        How should <strong>{formatMoney(total, currency)}</strong> be split?
      </p>

      <div className="split-prompt__rows">
        {POT_META.map(({ key, label, hint, tone }) => (
          <div key={key} className={`split-row split-row--${tone}`}>
            <div className="split-row__labels">
              <span className="split-row__name">{label}</span>
              <span className="split-row__hint">{hint}</span>
            </div>
            <input
              className="split-row__slider"
              type="range"
              min={0}
              max={total}
              step={0.01}
              value={values[key]}
              onChange={(e) => handleSlider(key, parseFloat(e.target.value))}
              aria-label={`${label} amount`}
            />
            <div className="split-row__input-wrap">
              <span className="split-row__currency" aria-hidden="true">£</span>
              <input
                className="split-row__input"
                type="number"
                min={0}
                max={total}
                step={0.01}
                value={values[key] === 0 ? "" : values[key]}
                onChange={(e) => handleInput(key, e.target.value)}
                aria-label={`${label} amount`}
              />
            </div>
          </div>
        ))}
      </div>

      <div
        className={`split-prompt__remainder ${isBalanced ? "split-prompt__remainder--ok" : "split-prompt__remainder--warn"}`}
        aria-live="polite"
      >
        {isBalanced
          ? "Fully split ✓"
          : remainder > 0
          ? `${formatMoney(remainder, currency)} left to assign`
          : `${formatMoney(Math.abs(remainder), currency)} over — reduce a pot`}
      </div>

      <button
        className="device-action"
        type="button"
        disabled={!isBalanced}
        onClick={() => isBalanced && onConfirm(values)}
      >
        Confirm split
      </button>
    </div>
  );
}

// ── Home page ────────────────────────────────────────────────

export default function HomePage() {
  const storedBalance = useSyncExternalStore(subscribe, getStoredBalanceSnapshot, () => null);
  const balance = parseStoredBalance(storedBalance);
  const [storedPlan, setStoredPlan] = useState<PenniPlan | null>(getInitialPlan);
  const plan =
    balance && (!storedPlan || storedPlan.currency !== balance.currency)
      ? createPlanFromBalance(balance)
      : storedPlan;
  const currency = balance?.currency ?? plan?.currency ?? "GBP";
  const pots = plan?.pots ?? { spend: 0, save: 0, give: 0 };
  const saveGoals = plan?.saveGoals ?? defaultSaveGoals;
  const balanceDelta = balance && plan ? roundMoney(balance.amount - plan.lastBalanceAmount) : 0;
  const pendingIncoming = balanceDelta > 0.009 ? balanceDelta : 0;
  const pendingOutgoing = balanceDelta < -0.009 ? Math.abs(balanceDelta) : 0;
  const balanceText = balance ? formatMoney(balance.amount, balance.currency) : formatMoney(0, currency);
  const lastCheckedText = formatLastChecked(balance?.updatedAt ?? balance?.fetchedAt);
  const cheerMessage = getCheerMessage(balance?.amount);
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

  const updatePlan = (nextPlan: PenniPlan) => {
    localStorage.setItem(planStorageKey, JSON.stringify(nextPlan));
    setStoredPlan(nextPlan);
  };

  const handleConfirmSplit = (newPots: SplitValues) => {
    if (!balance || !plan) return;
    // Save the chosen ratios as the new default for next time
    const total = pendingIncoming;
    if (total > 0) {
      localStorage.setItem(
        splitStorageKey,
        JSON.stringify({
          spend: roundMoney(newPots.spend / total),
          save: roundMoney(newPots.save / total),
          give: roundMoney(newPots.give / total),
        })
      );
    }
    updatePlan(reconcileSaveGoals({
      ...plan,
      lastBalanceAmount: balance.amount,
      pots: {
        spend: roundMoney(plan.pots.spend + newPots.spend),
        save: roundMoney(plan.pots.save + newPots.save),
        give: roundMoney(plan.pots.give + newPots.give),
      },
    }));
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
    if (!balance || !plan || !pendingOutgoing) {
      return;
    }

    const nextPots = deductFromPot(plan, pot, pendingOutgoing);
    const potDelta = {
      spend: roundMoney(plan.pots.spend - nextPots.spend),
      save: roundMoney(plan.pots.save - nextPots.save),
      give: roundMoney(plan.pots.give - nextPots.give),
    };
    updatePlan(reconcileSaveGoals({
      ...plan,
      lastBalanceAmount: balance.amount,
      pots: nextPots,
    }));
    appendHistory({
      id: crypto.randomUUID(),
      kind: "outgoing",
      amount: pendingOutgoing,
      currency,
      pots: potDelta,
      recordedAt: new Date().toISOString(),
    });
  };

  const jars = [
    { name: "Spend", value: pots.spend, tone: "pink", helper: "money for now" },
    { name: "Save", value: pots.save, tone: "green", helper: "money for goals" },
    { name: "Give", value: pots.give, tone: "gold", helper: "money to share" },
  ];

  return (
    <main className="prototype-page">
      <section className="prototype-shell" aria-labelledby="screen-title">
        <header className="prototype-header">
          <div className="prototype-brand">
            <Image
              className="prototype-pig"
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
          <nav className="prototype-nav" aria-label="Prototype tools">
            <Link href="/display">Display</Link>
            <Link href="/history">History</Link>
            <Link href="/settings">Setup</Link>
          </nav>
        </header>

        <section className="prototype-balance" aria-live="polite">
          <span>{statusText}</span>
          <strong>{balanceText}</strong>
          <p>{balance ? cheerMessage : "Connect a bank account, or use phone test mode."}</p>
        </section>

        {pendingIncoming ? (
          <section className="prototype-panel prototype-panel--action">
            <div className="prototype-panel__heading">
              <span>Money in</span>
              <strong>{formatMoney(pendingIncoming, currency)}</strong>
            </div>
            <SplitPrompt
              total={pendingIncoming}
              currency={currency}
              initial={splitAmount(pendingIncoming, getStoredSplit())}
              onConfirm={handleConfirmSplit}
            />
          </section>
        ) : (
          <>
            <section className="prototype-pots" aria-label="Money pots">
              {jars.map((jar) => (
                <article className={`prototype-pot prototype-pot--${jar.tone}`} key={jar.name}>
                  <div>
                    <span>{jar.name}</span>
                    <p>{jar.helper}</p>
                  </div>
                  <strong>{formatMoney(jar.value, currency)}</strong>
                </article>
              ))}
            </section>

            <section className="prototype-panel" aria-label="Savings goals">
              <div className="prototype-panel__heading">
                <span>Saving for</span>
                <strong>{formatMoney(pots.save, currency)}</strong>
              </div>
              <ul className="prototype-goals">
                {saveGoals.map((goal) => {
                  const allocated = goal.allocated ?? 0;
                  const progress = Math.max(0, Math.min(100, (allocated / goal.target) * 100));
                  return (
                    <li key={goal.id}>
                      <div className="prototype-goal-row">
                        <span>{goal.name}</span>
                        <strong>
                          {formatMoney(allocated, currency)} / {formatMoney(goal.target, currency)}
                        </strong>
                      </div>
                      <div
                        className="prototype-progress"
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

            {pendingOutgoing ? (
              <section className="prototype-panel prototype-panel--action">
                <div className="prototype-panel__heading">
                  <span>Money spent</span>
                  <strong>{formatMoney(pendingOutgoing, currency)}</strong>
                </div>
                <p>{nudgeText}</p>
                <div className="prototype-choice-grid" aria-label="Choose pot used for spending">
                  {POT_META.map((pot) => (
                    <button
                      className={`prototype-button prototype-button--${pot.tone}`}
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
              <section className="prototype-actions" aria-label="Bank actions">
                <a className="prototype-button prototype-button--primary" href="/api/auth-link">
                  {balance ? "Refresh bank" : "Connect bank"}
                </a>
                <Link className="prototype-button prototype-button--secondary" href="/settings">
                  Parent setup
                </Link>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
