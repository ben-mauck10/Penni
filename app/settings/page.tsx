"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { allocateSaveGoals, roundMoney, splitAmount } from "../../lib/money";
import {
  DEFAULT_SPLIT,
  readBalance,
  readOrCreatePlan,
  readSplit,
  writePlan,
  writeSplit,
} from "../../lib/storage";
import type { PenniPlan, SaveGoal } from "../../lib/types";

// ── Local form types ──────────────────────────────────────────

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

const DEFAULT_GOAL_ROWS: GoalRow[] = [{ id: "default", name: "Lego Set", target: "150" }];

// ── Page ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const [goals, setGoals] = useState<GoalRow[]>(DEFAULT_GOAL_ROWS);
  const [spendPct, setSpendPct] = useState(String(Math.round(DEFAULT_SPLIT.spend * 100)));
  const [savePct, setSavePct]   = useState(String(Math.round(DEFAULT_SPLIT.save  * 100)));
  const [givePct, setGivePct]   = useState(String(Math.round(DEFAULT_SPLIT.give  * 100)));
  const [splitError, setSplitError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  // Load stored values after mount.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const storedPlan = readOrCreatePlan();
      const storedSplit = readSplit();

      if (storedPlan?.saveGoals?.length) {
        setGoals(storedPlan.saveGoals.map(goalToRow));
      }
      setSpendPct(String(Math.round(storedSplit.spend * 100)));
      setSavePct(String(Math.round(storedSplit.save  * 100)));
      setGivePct(String(Math.round(storedSplit.give  * 100)));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  const spendNum = parseInt(spendPct, 10);
  const saveNum  = parseInt(savePct,  10);
  const giveNum  = parseInt(givePct,  10);
  const splitTotal =
    (isNaN(spendNum) ? 0 : spendNum) +
    (isNaN(saveNum)  ? 0 : saveNum)  +
    (isNaN(giveNum)  ? 0 : giveNum);

  const updateGoal = (id: string, field: "name" | "target", value: string) => {
    setSaved(false);
    setGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, [field]: value, [`${field}Error`]: undefined } : g))
    );
  };

  const addGoal = () => {
    setSaved(false);
    setGoals((prev) => [...prev, { id: crypto.randomUUID(), name: "", target: "" }]);
  };

  const removeGoal = (id: string) => {
    setSaved(false);
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const handleSave = () => {
    setSaved(false);

    // Validate goals.
    let goalsValid = true;
    const validatedGoals = goals.map((g) => {
      const nameError   = g.name.trim() ? undefined : "Name required.";
      const targetNum   = parseFloat(g.target);
      const targetError = isNaN(targetNum) || targetNum <= 0 ? "Enter an amount > 0." : undefined;
      if (nameError || targetError) goalsValid = false;
      return { ...g, nameError, targetError };
    });
    setGoals(validatedGoals);

    if (goals.length === 0) {
      setGoals([{ id: crypto.randomUUID(), name: "", target: "", nameError: "Add at least one goal." }]);
      goalsValid = false;
    }

    // Validate split.
    let nextSplitError: string | undefined;
    if (isNaN(spendNum) || spendNum < 0 || isNaN(saveNum) || saveNum < 0 || isNaN(giveNum) || giveNum < 0) {
      nextSplitError = "Each percentage must be a positive number.";
    } else if (splitTotal !== 100) {
      nextSplitError = `Percentages must add up to 100. Currently: ${splitTotal}.`;
    }
    setSplitError(nextSplitError);

    if (!goalsValid || nextSplitError) return;

    // Build the split ratios.
    const newSplit = { spend: spendNum / 100, save: saveNum / 100, give: giveNum / 100 };
    writeSplit(newSplit);

    // Persist plan with updated goals, preserving existing pot values.
    const existing = readOrCreatePlan() ?? (() => {
      const balance = readBalance();
      if (!balance) return null;
      const pots = splitAmount(balance.amount, newSplit);
      return {
        currency: balance.currency,
        lastBalanceAmount: balance.amount,
        pots,
        saveGoals: [],
      } satisfies PenniPlan;
    })();

    const savedGoals: SaveGoal[] = validatedGoals.map((g) => ({
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
    writePlan(nextPlan);

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

        {/* Savings goals */}
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
                    <label htmlFor={`goal-name-${goal.id}`}>Goal {index + 1} name</label>
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

        {/* Money split */}
        <section className="settings-section" aria-labelledby="split-heading">
          <h2 id="split-heading">Money split</h2>
          <p className="settings-desc">
            When new money arrives, how should it be divided? Must add up to 100%.
          </p>

          <div className="settings-split-grid">
            {[
              { id: "spend-pct", label: "Spend", hint: "everyday spending", tone: "pink",  value: spendPct, set: setSpendPct },
              { id: "save-pct",  label: "Save",  hint: "towards goals",     tone: "green", value: savePct,  set: setSavePct  },
              { id: "give-pct",  label: "Give",  hint: "sharing & donating", tone: "gold", value: givePct,  set: setGivePct  },
            ].map(({ id, label, hint, tone, value, set }) => (
              <div key={id} className={`settings-field settings-split-field settings-split-field--${tone}`}>
                <label htmlFor={id}>
                  <span className="split-label-name">{label}</span>
                  <span className="split-label-hint">{hint}</span>
                </label>
                <div className="settings-input-suffix">
                  <input
                    id={id}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={value}
                    onChange={(e) => { set(e.target.value); setSaved(false); }}
                    aria-invalid={!!splitError}
                  />
                  <span aria-hidden="true">%</span>
                </div>
              </div>
            ))}
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
