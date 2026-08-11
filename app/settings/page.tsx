"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SaveGoal = {
  id: string;
  name: string;
  target: number;
  allocated?: number;
};

type PenniPlan = {
  currency: string;
  lastBalanceAmount: number;
  pots: { spend: number; save: number; give: number };
  saveGoals: SaveGoal[];
};

type PenniSplit = {
  spend: number;
  save: number;
  give: number;
};

const planStorageKey = "penni-plan";
const splitStorageKey = "penni-split";
const balanceStorageKey = "penny-pig-balance";
const defaultSplit: PenniSplit = { spend: 0.4, save: 0.5, give: 0.1 };

type StoredBalance = {
  amount: number;
  currency: string;
};

function roundMoney(amount: number) {
  return Math.round(amount * 100) / 100;
}

function splitAmount(amount: number, split: PenniSplit) {
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

function getStoredBalance(): StoredBalance | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(balanceStorageKey) ?? sessionStorage.getItem(balanceStorageKey);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as Partial<StoredBalance>;
    if (typeof parsed.amount !== "number" || !parsed.currency) return null;

    return { amount: parsed.amount, currency: parsed.currency };
  } catch {
    return null;
  }
}

function getStoredPlan(): PenniPlan | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(planStorageKey);
    if (!stored) return null;
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
    // Migrate old single saveGoal
    let saveGoals: SaveGoal[];
    if (Array.isArray(parsed.saveGoals) && parsed.saveGoals.length > 0) {
      saveGoals = parsed.saveGoals.map((goal) => ({
        ...goal,
        allocated: typeof goal.allocated === "number" ? goal.allocated : undefined,
      }));
    } else if (parsed.saveGoal?.name && typeof parsed.saveGoal.target === "number") {
      saveGoals = [{ id: "migrated", name: parsed.saveGoal.name, target: parsed.saveGoal.target }];
    } else {
      saveGoals = [{ id: "default", name: "Lego Set", target: 150 }];
    }
    return { ...(parsed as PenniPlan), saveGoals: allocateSaveGoals(saveGoals, parsed.pots.save) };
  } catch {
    return null;
  }
}

function getStoredSplit(): PenniSplit {
  if (typeof window === "undefined") return defaultSplit;
  try {
    const stored = localStorage.getItem(splitStorageKey);
    if (!stored) return defaultSplit;
    const parsed = JSON.parse(stored) as Partial<PenniSplit>;
    if (
      typeof parsed.spend !== "number" ||
      typeof parsed.save !== "number" ||
      typeof parsed.give !== "number"
    ) {
      return defaultSplit;
    }
    return parsed as PenniSplit;
  } catch {
    return defaultSplit;
  }
}

function getFallbackPlan(): PenniPlan | null {
  const balance = getStoredBalance();
  if (!balance) return null;

  const split = getStoredSplit();
  const pots = splitAmount(balance.amount, split);

  return {
    currency: balance.currency,
    lastBalanceAmount: balance.amount,
    pots,
    saveGoals: allocateSaveGoals([{ id: "default", name: "Lego Set", target: 150 }], pots.save),
  };
}

type GoalRow = {
  id: string;
  name: string;
  target: string; // string so input is controlled cleanly
  nameError?: string;
  targetError?: string;
};

function goalToRow(g: SaveGoal): GoalRow {
  return { id: g.id, name: g.name, target: String(g.target) };
}

type SplitError = string | undefined;
const defaultGoalRows: GoalRow[] = [{ id: "default", name: "Lego Set", target: "150" }];

export default function SettingsPage() {
  const [goals, setGoals] = useState<GoalRow[]>(defaultGoalRows);
  const [spendPct, setSpendPct] = useState(String(Math.round(defaultSplit.spend * 100)));
  const [savePct, setSavePct] = useState(String(Math.round(defaultSplit.save * 100)));
  const [givePct, setGivePct] = useState(String(Math.round(defaultSplit.give * 100)));
  const [splitError, setSplitError] = useState<SplitError>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const storedPlan = getStoredPlan() ?? getFallbackPlan();
      const storedSplit = getStoredSplit();

      setGoals(storedPlan?.saveGoals?.map(goalToRow) ?? defaultGoalRows);
      setSpendPct(String(Math.round(storedSplit.spend * 100)));
      setSavePct(String(Math.round(storedSplit.save * 100)));
      setGivePct(String(Math.round(storedSplit.give * 100)));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  const spendNum = parseInt(spendPct, 10);
  const saveNum = parseInt(savePct, 10);
  const giveNum = parseInt(givePct, 10);
  const splitTotal =
    (isNaN(spendNum) ? 0 : spendNum) +
    (isNaN(saveNum) ? 0 : saveNum) +
    (isNaN(giveNum) ? 0 : giveNum);

  const updateGoal = (id: string, field: "name" | "target", value: string) => {
    setSaved(false);
    setGoals((prev) =>
      prev.map((g) =>
        g.id === id ? { ...g, [field]: value, [`${field}Error`]: undefined } : g
      )
    );
  };

  const addGoal = () => {
    setSaved(false);
    setGoals((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: "", target: "" },
    ]);
  };

  const removeGoal = (id: string) => {
    setSaved(false);
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const handleSave = () => {
    setSaved(false);

    // Validate goals
    let goalsValid = true;
    const validatedGoals = goals.map((g) => {
      const nameError = g.name.trim() ? undefined : "Name required.";
      const targetNum = parseFloat(g.target);
      const targetError =
        isNaN(targetNum) || targetNum <= 0 ? "Enter an amount > 0." : undefined;
      if (nameError || targetError) goalsValid = false;
      return { ...g, nameError, targetError };
    });
    setGoals(validatedGoals);

    if (goals.length === 0) {
      setGoals([{ id: crypto.randomUUID(), name: "", target: "", nameError: "Add at least one goal." }]);
      goalsValid = false;
    }

    // Validate split
    let nextSplitError: SplitError;
    if (
      isNaN(spendNum) || spendNum < 0 ||
      isNaN(saveNum) || saveNum < 0 ||
      isNaN(giveNum) || giveNum < 0
    ) {
      nextSplitError = "Each percentage must be a positive number.";
    } else if (splitTotal !== 100) {
      nextSplitError = `Percentages must add up to 100. Currently: ${splitTotal}.`;
    }
    setSplitError(nextSplitError);

    if (!goalsValid || nextSplitError) return;

    // Persist plan with updated goals
    const existing = getStoredPlan() ?? getFallbackPlan();
    const savedGoals = validatedGoals.map((g) => ({
      id: g.id,
      name: g.name.trim(),
      target: parseFloat(g.target),
    }));
    const nextPlan: PenniPlan = {
      currency: existing?.currency ?? "GBP",
      lastBalanceAmount: existing?.lastBalanceAmount ?? 0,
      pots: existing?.pots ?? { spend: 0, save: 0, give: 0 },
      saveGoals: allocateSaveGoals(savedGoals, existing?.pots.save ?? 0),
    };
    localStorage.setItem(planStorageKey, JSON.stringify(nextPlan));

    // Persist split
    localStorage.setItem(
      splitStorageKey,
      JSON.stringify({ spend: spendNum / 100, save: saveNum / 100, give: giveNum / 100 })
    );

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <main className="settings-page">
      <div className="settings-panel">
        <header className="settings-header">
          <div>
            <p className="eyebrow">Penni Oinkbank</p>
            <h1>Settings</h1>
          </div>
          <Link className="settings-back" href="/" aria-label="Back to home">
            ← Home
          </Link>
        </header>

        {/* ── Savings goals ── */}
        <section className="settings-section" aria-labelledby="goals-heading">
          <h2 id="goals-heading">Savings goals</h2>
          <p className="settings-desc">
            Add as many goals as you like. Progress is tracked against the shared Save pot.
          </p>

          <ol className="goals-list" aria-label="Savings goals list">
            {goals.map((goal, index) => (
              <li key={goal.id} className="goals-list__item">
                <div className="goals-list__fields">
                  <div className="settings-field">
                    <label htmlFor={`goal-name-${goal.id}`}>
                      Goal {index + 1} name
                    </label>
                    <input
                      id={`goal-name-${goal.id}`}
                      type="text"
                      value={goal.name}
                      onChange={(e) => updateGoal(goal.id, "name", e.target.value)}
                      maxLength={40}
                      placeholder="e.g. Lego Set"
                      aria-invalid={!!goal.nameError}
                    />
                    {goal.nameError && (
                      <span className="settings-error" role="alert">{goal.nameError}</span>
                    )}
                  </div>

                  <div className="settings-field">
                    <label htmlFor={`goal-target-${goal.id}`}>Target</label>
                    <div className="settings-input-prefix">
                      <span aria-hidden="true">£</span>
                      <input
                        id={`goal-target-${goal.id}`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={goal.target}
                        onChange={(e) => updateGoal(goal.id, "target", e.target.value)}
                        placeholder="150"
                        aria-invalid={!!goal.targetError}
                      />
                    </div>
                    {goal.targetError && (
                      <span className="settings-error" role="alert">{goal.targetError}</span>
                    )}
                  </div>
                </div>

                {goals.length > 1 && (
                  <button
                    type="button"
                    className="goals-list__remove"
                    onClick={() => removeGoal(goal.id)}
                    aria-label={`Remove goal ${index + 1}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ol>

          <button type="button" className="goals-add-btn" onClick={addGoal}>
            + Add another goal
          </button>
        </section>

        {/* ── Money split ── */}
        <section className="settings-section" aria-labelledby="split-heading">
          <h2 id="split-heading">Money split</h2>
          <p className="settings-desc">
            When new money arrives, how should it be divided? Must add up to 100%.
          </p>

          <div className="settings-split-grid">
            <div className="settings-field settings-split-field settings-split-field--pink">
              <label htmlFor="spend-pct">
                <span className="split-label-name">Spend</span>
                <span className="split-label-hint">everyday spending</span>
              </label>
              <div className="settings-input-suffix">
                <input
                  id="spend-pct"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={spendPct}
                  onChange={(e) => { setSpendPct(e.target.value); setSaved(false); }}
                  aria-invalid={!!splitError}
                />
                <span aria-hidden="true">%</span>
              </div>
            </div>

            <div className="settings-field settings-split-field settings-split-field--green">
              <label htmlFor="save-pct">
                <span className="split-label-name">Save</span>
                <span className="split-label-hint">towards goals</span>
              </label>
              <div className="settings-input-suffix">
                <input
                  id="save-pct"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={savePct}
                  onChange={(e) => { setSavePct(e.target.value); setSaved(false); }}
                  aria-invalid={!!splitError}
                />
                <span aria-hidden="true">%</span>
              </div>
            </div>

            <div className="settings-field settings-split-field settings-split-field--gold">
              <label htmlFor="give-pct">
                <span className="split-label-name">Give</span>
                <span className="split-label-hint">sharing &amp; donating</span>
              </label>
              <div className="settings-input-suffix">
                <input
                  id="give-pct"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={givePct}
                  onChange={(e) => { setGivePct(e.target.value); setSaved(false); }}
                  aria-invalid={!!splitError}
                />
                <span aria-hidden="true">%</span>
              </div>
            </div>
          </div>

          <div
            className={`settings-split-total ${splitTotal === 100 ? "settings-split-total--ok" : "settings-split-total--warn"}`}
            aria-live="polite"
          >
            Total: {splitTotal}%{splitTotal === 100 ? " ✓" : " — must equal 100%"}
          </div>

          {splitError && (
            <span className="settings-error" role="alert">{splitError}</span>
          )}
        </section>

        <div className="settings-actions">
          <button className="settings-save-btn" type="button" onClick={handleSave}>
            Save settings
          </button>
          {saved && (
            <span className="settings-saved-msg" role="status" aria-live="polite">
              Saved ✓
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
