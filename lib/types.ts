// Shared types used across all pages and storage helpers.

export type StoredBalance = {
  amount: number;
  currency: string;
  accountName: string;
  updatedAt?: string;
  fetchedAt: string;
};

export type SaveGoal = {
  id: string;
  name: string;
  target: number;
  allocated?: number;
};

export type PenniPlan = {
  currency: string;
  lastBalanceAmount: number;
  pots: {
    spend: number;
    save: number;
    give: number;
  };
  saveGoals: SaveGoal[];
};

export type PenniSplit = {
  spend: number;
  save: number;
  give: number;
};

export type HistoryEntry = {
  id: string;
  kind: "incoming" | "outgoing";
  amount: number;
  currency: string;
  pots: PenniSplit;
  recordedAt: string;
};

export type PotKey = keyof PenniPlan["pots"];
