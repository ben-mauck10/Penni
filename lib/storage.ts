import type { HistoryEntry, PenniPlan, PenniSplit, SaveGoal, StoredBalance } from "./types";
import { allocateSaveGoals, roundMoney, splitAmount } from "./money";

// ── Storage keys ──────────────────────────────────────────────

export const KEYS = {
  balance: "penny-pig-balance",
  plan: "penni-plan",
  split: "penni-split",
  history: "penni-history",
} as const;

export const MAX_HISTORY = 50;

export const DEFAULT_SPLIT: PenniSplit = { spend: 0.4, save: 0.5, give: 0.1 };

export const DEFAULT_GOALS: SaveGoal[] = [
  { id: "default", name: "Lego Set", target: 150 },
];

// ── Parsers ───────────────────────────────────────────────────

export function parseStoredBalance(stored: string | null): StoredBalance | null {
  try {
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<StoredBalance>;
    if (typeof parsed.amount !== "number" || !parsed.currency) return null;
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

export function parseStoredPlan(stored: string | null): PenniPlan | null {
  try {
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

    let saveGoals: SaveGoal[];
    if (Array.isArray(parsed.saveGoals) && parsed.saveGoals.length > 0) {
      saveGoals = parsed.saveGoals.filter(
        (g) => g && typeof g.name === "string" && typeof g.target === "number"
      );
    } else if (parsed.saveGoal?.name && typeof parsed.saveGoal.target === "number") {
      // Migrate old single-goal format
      saveGoals = [
        { id: "migrated", name: parsed.saveGoal.name, target: parsed.saveGoal.target },
      ];
    } else {
      saveGoals = DEFAULT_GOALS;
    }

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

export function parseStoredSplit(stored: string | null): PenniSplit {
  try {
    if (!stored) return DEFAULT_SPLIT;
    const parsed = JSON.parse(stored) as Partial<PenniSplit>;
    if (
      typeof parsed.spend !== "number" ||
      typeof parsed.save !== "number" ||
      typeof parsed.give !== "number"
    ) {
      return DEFAULT_SPLIT;
    }
    return parsed as PenniSplit;
  } catch {
    return DEFAULT_SPLIT;
  }
}

// ── Readers ───────────────────────────────────────────────────

export function readBalance(): StoredBalance | null {
  if (typeof window === "undefined") return null;
  return parseStoredBalance(
    localStorage.getItem(KEYS.balance) ?? sessionStorage.getItem(KEYS.balance)
  );
}

export function readPlan(): PenniPlan | null {
  if (typeof window === "undefined") return null;
  return parseStoredPlan(localStorage.getItem(KEYS.plan));
}

export function readSplit(): PenniSplit {
  if (typeof window === "undefined") return DEFAULT_SPLIT;
  return parseStoredSplit(localStorage.getItem(KEYS.split));
}

export function readHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(KEYS.history);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

// ── Writers ───────────────────────────────────────────────────

export function writeBalance(balance: StoredBalance): void {
  const json = JSON.stringify(balance);
  localStorage.setItem(KEYS.balance, json);
  sessionStorage.setItem(KEYS.balance, json);
}

export function writePlan(plan: PenniPlan): void {
  localStorage.setItem(KEYS.plan, JSON.stringify(plan));
}

export function writeSplit(split: PenniSplit): void {
  localStorage.setItem(KEYS.split, JSON.stringify(split));
}

export function appendHistory(entry: HistoryEntry): void {
  try {
    const existing = readHistory();
    const next = [entry, ...existing].slice(0, MAX_HISTORY);
    localStorage.setItem(KEYS.history, JSON.stringify(next));
  } catch {
    // Non-critical — ignore silently
  }
}

// ── Plan helpers ──────────────────────────────────────────────

/** Creates a fresh plan from a balance using the stored (or default) split ratios. */
export function createPlanFromBalance(balance: StoredBalance): PenniPlan {
  const split = readSplit();
  const pots = splitAmount(balance.amount, split);
  return {
    currency: balance.currency,
    lastBalanceAmount: balance.amount,
    pots,
    saveGoals: allocateSaveGoals(DEFAULT_GOALS, pots.save),
  };
}

/** Re-allocates save goals against the current save pot. */
export function reconcileSaveGoals(plan: PenniPlan): PenniPlan {
  return {
    ...plan,
    saveGoals: allocateSaveGoals(plan.saveGoals, plan.pots.save),
  };
}

/** Reads the stored plan, or falls back to generating one from the stored balance. */
export function readOrCreatePlan(): PenniPlan | null {
  const plan = readPlan();
  if (plan) return plan;

  const balance = readBalance();
  if (!balance) return null;

  return createPlanFromBalance(balance);
}

// ── Balance snapshot for useSyncExternalStore ─────────────────

/**
 * A subscribable store for the balance so pages can react to cross-tab
 * storage events and the custom "penni-balance-updated" event.
 */
export const BALANCE_UPDATED_EVENT = "penni-balance-updated";

export function subscribeToBalance(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(BALANCE_UPDATED_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(BALANCE_UPDATED_EVENT, callback);
  };
}

export function getBalanceSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEYS.balance);
}

export function getBalanceServerSnapshot(): null {
  return null;
}

export function dispatchBalanceUpdated(): void {
  window.dispatchEvent(new Event(BALANCE_UPDATED_EVENT));
}
