"use client";

import { useCallback, useState } from "react";
import { formatMoney, roundMoney } from "../../lib/money";
import type { PenniSplit } from "../../lib/types";

export const POT_META = [
  { key: "spend" as const, label: "Spend", hint: "everyday spending", tone: "pink" },
  { key: "save"  as const, label: "Save",  hint: "towards goals",     tone: "green" },
  { key: "give"  as const, label: "Give",  hint: "sharing & giving",  tone: "gold" },
] as const;

type Props = {
  total: number;
  currency: string;
  initial: PenniSplit;
  onConfirm: (values: PenniSplit) => void;
};

export default function SplitPrompt({ total, currency, initial, onConfirm }: Props) {
  const [values, setValues] = useState<PenniSplit>(initial);

  const remainder = roundMoney(total - values.spend - values.save - values.give);
  const isBalanced = Math.abs(remainder) < 0.005;

  // When a slider moves, scale the other two proportionally.
  const handleSlider = useCallback(
    (changed: keyof PenniSplit, raw: number) => {
      const newVal = Math.min(raw, total);
      const others = POT_META.map((p) => p.key).filter((k) => k !== changed) as (keyof PenniSplit)[];
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

      setValues({ ...values, [changed]: newVal, [others[0]]: a, [others[1]]: b });
    },
    [values, total]
  );

  // Direct number input — just update that field.
  const handleInput = useCallback((changed: keyof PenniSplit, raw: string) => {
    const parsed = parseFloat(raw);
    setValues((prev) => ({
      ...prev,
      [changed]: isNaN(parsed) ? 0 : Math.max(0, roundMoney(parsed)),
    }));
  }, []);

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
        className="home-action"
        type="button"
        disabled={!isBalanced}
        onClick={() => isBalanced && onConfirm(values)}
      >
        Confirm split
      </button>
    </div>
  );
}
