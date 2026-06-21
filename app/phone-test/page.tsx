"use client";

import Link from "next/link";
import { useEffect } from "react";

const balanceStorageKey = "penny-pig-balance";
const planStorageKey = "penni-plan";
const historyStorageKey = "penni-history";

function getDemoBalance() {
  const params = new URLSearchParams(window.location.search);
  const requestedAmount = Number.parseFloat(params.get("balance") ?? "");
  const amount = Number.isFinite(requestedAmount) && requestedAmount >= 0 ? requestedAmount : 86.42;
  const now = new Date().toISOString();

  return {
    amount,
    currency: "GBP",
    accountName: "Phone test balance",
    updatedAt: now,
    fetchedAt: now,
  };
}

export default function PhoneTestPage() {
  useEffect(() => {
    localStorage.setItem(balanceStorageKey, JSON.stringify(getDemoBalance()));
    localStorage.removeItem(planStorageKey);
    localStorage.removeItem(historyStorageKey);
    window.location.replace("/");
  }, []);

  return (
    <main className="settings-page">
      <section className="settings-panel" aria-labelledby="phone-test-title">
        <header className="settings-header">
          <div>
            <p className="eyebrow">Penni Oinkbank</p>
            <h1 id="phone-test-title">Phone test</h1>
          </div>
          <Link className="settings-back" href="/" aria-label="Back to home">
            Home
          </Link>
        </header>

        <section className="settings-section">
          <h2>Preparing test balance</h2>
          <p className="settings-desc">
            This local development helper adds a demo balance to this device only.
          </p>
        </section>
      </section>
    </main>
  );
}
