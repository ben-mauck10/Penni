import { describe, expect, it } from "vitest";
import { getScriptForChapter } from "../tts";
import type { YotoPresentationState } from "../types";

const baseState: YotoPresentationState = {
  balanceMode: "hidden",
  goalName: "bike",
  goalProgressPercent: 40,
  weeklyChangePence: 1234,
  activityPromptId: "default",
  generatedAt: "2026-09-13T00:00:00.000Z",
};

describe("getScriptForChapter", () => {
  it("does not speak currency values in hidden mode", () => {
    const update = getScriptForChapter("update", baseState);
    const changed = getScriptForChapter("changed", baseState);

    expect(update).not.toContain("£");
    expect(changed).not.toContain("£");
    expect(update).toContain("40% of the way");
  });

  it("speaks rounded and exact amounts in update mode", () => {
    expect(
      getScriptForChapter("update", {
        ...baseState,
        balanceMode: "rounded",
        availableAmountPence: 1200,
      })
    ).toContain("about £12");

    expect(
      getScriptForChapter("update", {
        ...baseState,
        balanceMode: "exact",
        availableAmountPence: 1234,
      })
    ).toContain("£12.34");
  });
});
