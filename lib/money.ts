import type { PenniSplit, SaveGoal } from "./types";

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatLastChecked(dateText?: string): string {
  if (!dateText) return "Waiting for bank";

  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return "Linked";

  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function splitAmount(
  amount: number,
  split: PenniSplit
): PenniSplit {
  const spend = roundMoney(amount * split.spend);
  const save = roundMoney(amount * split.save);
  const give = roundMoney(amount - spend - save);
  return { spend, save, give };
}

export function allocateSaveGoals(goals: SaveGoal[], savePot: number): SaveGoal[] {
  let remaining = roundMoney(savePot);

  return goals.map((goal) => {
    const allocated = roundMoney(Math.min(goal.target, Math.max(0, remaining)));
    remaining = roundMoney(remaining - allocated);
    return { ...goal, allocated };
  });
}

/** Deducts `amount` from `pot`, spilling into the others if needed. */
export function deductFromPot(
  pots: PenniSplit,
  preferredPot: keyof PenniSplit,
  amount: number
): PenniSplit {
  const next = { ...pots };
  let remaining = roundMoney(amount);

  const order: (keyof PenniSplit)[] = [
    preferredPot,
    ...(["spend", "save", "give"] as (keyof PenniSplit)[]).filter(
      (k) => k !== preferredPot
    ),
  ];

  for (const key of order) {
    const from = Math.min(next[key], remaining);
    next[key] = roundMoney(next[key] - from);
    remaining = roundMoney(remaining - from);
    if (remaining <= 0) break;
  }

  return next;
}

const CHEER_THRESHOLDS = [
  { min: 100, message: "Feeling flush! 🐷" },
  { min: 50,  message: "Nice one — keep saving!" },
  { min: 20,  message: "A solid start." },
  { min: 0,   message: "Every penny counts." },
] as const;

export function getCheerMessage(amount?: number): string {
  if (amount === undefined) return "Every penny counts.";
  return (
    CHEER_THRESHOLDS.find((t) => amount >= t.min)?.message ??
    "Every penny counts."
  );
}
