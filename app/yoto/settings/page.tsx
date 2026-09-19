"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────

type ConnectionStatus =
  | "not_connected"
  | "connecting"
  | "connected_no_playlist"
  | "playlist_ready"
  | "ready"
  | "needs_attention";

type BalanceMode = "hidden" | "rounded" | "exact";

interface YotoStatus {
  status: ConnectionStatus;
  yotoAccountId?: string;
  balanceMode?: BalanceMode;
  playlistId?: string;
}

// ── Helpers ───────────────────────────────────────────────────

function extractErrorMessage(body: unknown): string {
  if (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as Record<string, unknown>).error === "string"
  ) {
    return (body as Record<string, string>).error;
  }
  return "Something went wrong. Please try again.";
}

function getYotoQueryMessage(): string | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  if (params.get("yoto") !== "error") return null;

  const reason = params.get("reason");
  switch (reason) {
    case "denied":
      return "Yoto connection was cancelled before access was granted.";
    case "expired":
      return "The Yoto connection attempt expired. Please try connecting again.";
    case "state_mismatch":
    case "no_session":
      return "Yoto connection session could not be verified. Please start again from this page.";
    case "exchange_http_400":
      return "Yoto rejected the connection callback. Check the production redirect URL and selected scopes in the Yoto developer dashboard.";
    case "exchange_http_401":
      return "Yoto rejected the client credentials. Check that Vercel has the current rotated Yoto client secret.";
    case "exchange_http_403":
      return "Yoto rejected this app's permissions. Check the app type and scopes in the Yoto developer dashboard.";
    case "exchange_failed":
      return "Yoto connection failed while exchanging the login code. Check Vercel function logs for /api/yoto/callback.";
    default:
      return reason
        ? `Yoto connection failed (${reason}). Check Vercel function logs for /api/yoto/callback.`
        : "Yoto connection failed. Please try again.";
  }
}

function hasYotoQueryError(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("yoto") === "error";
}

// ── Sub-components ────────────────────────────────────────────

function Spinner() {
  return (
    <span
      aria-label="Loading"
      style={{
        display: "inline-block",
        width: 24,
        height: 24,
        border: "3px solid rgba(17,29,58,0.15)",
        borderTopColor: "var(--berry)",
        borderRadius: "50%",
        animation: "yoto-spin 0.7s linear infinite",
      }}
    />
  );
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 8,
        background: "#fff7fb",
        border: "1px solid rgba(243,41,114,0.3)",
        color: "var(--berry)",
        fontWeight: 700,
        fontSize: "0.9rem",
        lineHeight: 1.45,
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        style={{
          flexShrink: 0,
          border: "none",
          background: "none",
          color: "var(--berry)",
          fontWeight: 900,
          fontSize: "1.1rem",
          cursor: "pointer",
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ── Panels ────────────────────────────────────────────────────

function NotConnectedPanel({ onAction }: { onAction?: () => void }) {
  return (
    <div className="settings-section">
      <h2>Connect Yoto</h2>
      <p className="settings-desc">
        Connect your Yoto account to give your child a Penni card experience.
      </p>
      <div>
        <a
          href="/api/yoto/auth-link"
          className="settings-save-btn"
          style={{ textDecoration: "none", display: "inline-flex" }}
          onClick={onAction}
        >
          Connect Yoto
        </a>
      </div>
    </div>
  );
}

function ConnectingPanel() {
  return (
    <div className="settings-section" style={{ alignItems: "center", textAlign: "center" }}>
      <Spinner />
      <p className="settings-desc" style={{ margin: 0 }}>
        Connecting to Yoto…
      </p>
    </div>
  );
}

function ConnectedNoPlaylistPanel({
  onCreatePlaylist,
  loading,
}: {
  onCreatePlaylist: () => void;
  loading: boolean;
}) {
  return (
    <div className="settings-section">
      <h2>Yoto Connected</h2>
      <p className="settings-desc">
        Yoto connected. Create a Penni Pig playlist to continue.
      </p>
      <div>
        <button
          type="button"
          className="settings-save-btn"
          onClick={onCreatePlaylist}
          disabled={loading}
        >
          {loading ? "Creating…" : "Create Penni playlist"}
        </button>
      </div>
    </div>
  );
}

function PlaylistReadyPanel({
  onPreview,
}: {
  onPreview: () => void;
}) {
  return (
    <div className="settings-section">
      <h2>Almost ready!</h2>
      <p className="settings-desc">
        Your Penni Pig playlist is ready. Open the Yoto app and link it to a blank MYO card.
      </p>
      <ol
        style={{
          margin: "4px 0 0",
          paddingLeft: "1.4em",
          color: "var(--muted)",
          fontSize: "0.9rem",
          lineHeight: 1.65,
          fontWeight: 700,
        }}
      >
        <li>Open the Yoto app</li>
        <li>Find &ldquo;Penni Pig&rdquo; in My Content</li>
        <li>Link it to a blank MYO card</li>
      </ol>
      <div>
        <button
          type="button"
          className="settings-save-btn"
          onClick={onPreview}
        >
          Preview
        </button>
      </div>
    </div>
  );
}

function ReadyPanel({
  balanceMode: initialBalanceMode,
  onRegenerate,
  onDisconnect,
  onSaveBalanceMode,
  loading,
}: {
  balanceMode: BalanceMode;
  onRegenerate: () => void;
  onDisconnect: () => void;
  onSaveBalanceMode: (mode: BalanceMode) => void;
  loading: boolean;
}) {
  const [selectedMode, setSelectedMode] = useState<BalanceMode>(initialBalanceMode);

  // Sync if parent status refetches with a different value
  useEffect(() => {
    setSelectedMode(initialBalanceMode);
  }, [initialBalanceMode]);

  const balanceModeOptions: { value: BalanceMode; label: string; hint: string }[] = [
    { value: "hidden", label: "Hidden", hint: "No amount is spoken" },
    { value: "rounded", label: "Rounded", hint: 'e.g. "about £12"' },
    { value: "exact", label: "Exact", hint: 'e.g. "£12.34"' },
  ];

  return (
    <div className="settings-section">
      <h2>Penni card is ready 🎉</h2>
      <p className="settings-desc">Your Penni card is set up and ready!</p>

      {/* Balance mode */}
      <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
        <legend
          style={{
            fontSize: "0.85rem",
            fontWeight: 900,
            color: "var(--foreground)",
            marginBottom: 8,
          }}
        >
          Balance mode
        </legend>
        <div style={{ display: "grid", gap: 8 }}>
          {balanceModeOptions.map(({ value, label, hint }) => (
            <label
              key={value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${selectedMode === value ? "var(--berry)" : "rgba(17,29,58,0.12)"}`,
                background: selectedMode === value ? "#fff7fb" : "#fff",
                cursor: "pointer",
                fontSize: "0.9rem",
                fontWeight: 700,
              }}
            >
              <input
                type="radio"
                name="balance-mode"
                value={value}
                checked={selectedMode === value}
                onChange={() => setSelectedMode(value)}
                style={{ accentColor: "var(--berry)", width: 16, height: 16 }}
              />
              <span>
                <strong style={{ display: "block", fontWeight: 900 }}>{label}</strong>
                <span style={{ color: "var(--muted)", fontSize: "0.82rem", fontWeight: 600 }}>{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <button
          type="button"
          className="settings-save-btn"
          onClick={() => onSaveBalanceMode(selectedMode)}
          disabled={loading}
        >
          {loading ? "Saving…" : "Save balance setting"}
        </button>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="settings-save-btn"
          onClick={onRegenerate}
          disabled={loading}
          style={{ background: "var(--sky)" }}
        >
          {loading ? "Working…" : "Test / regenerate"}
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={loading}
          style={{
            display: "inline-flex",
            minHeight: 46,
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid rgba(17,29,58,0.18)",
            borderRadius: 8,
            padding: "0 20px",
            background: "#fff",
            color: "var(--berry)",
            fontFamily: "inherit",
            fontSize: "1rem",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

function NeedsAttentionPanel() {
  return (
    <div className="settings-section">
      <h2>Reconnect Yoto</h2>
      <p className="settings-desc">
        Your Yoto connection needs attention. Please reconnect.
      </p>
      <div>
        <a
          href="/api/yoto/auth-link"
          className="settings-save-btn"
          style={{ textDecoration: "none", display: "inline-flex" }}
        >
          Reconnect
        </a>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function YotoSettingsPage() {
  const [statusData, setStatusData] = useState<YotoStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/yoto/status");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMessage(extractErrorMessage(body));
        return;
      }
      setStatusData(body as YotoStatus);
      if (!hasYotoQueryError()) {
        setErrorMessage(null);
      }
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    }
  }, []);

  useEffect(() => {
    const queryMessage = getYotoQueryMessage();
    if (queryMessage) {
      setErrorMessage(queryMessage);
    }
    void fetchStatus();
  }, [fetchStatus]);

  const handleCreatePlaylist = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/yoto/playlist", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMessage(extractErrorMessage(body));
      } else {
        setErrorMessage(null);
        await fetchStatus();
      }
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveBalanceMode = async (balanceMode: BalanceMode) => {
    setLoading(true);
    try {
      const res = await fetch("/api/yoto/balance-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balanceMode }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMessage(extractErrorMessage(body));
      } else {
        setErrorMessage(null);
        await fetchStatus();
      }
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/yoto/playlist", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMessage(extractErrorMessage(body));
      } else {
        setErrorMessage(null);
        await fetchStatus();
      }
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    // Requirement 9.4: present opt-in for playlist deletion
    // Use window.confirm — null means dialog was closed without a choice (do nothing)
    const confirmed = window.confirm(
      "Disconnect Yoto? Also delete the Penni Pig playlist from your Yoto library?"
    );

    // window.confirm returns true (OK) or false (Cancel); closing returns false on most browsers
    // We distinguish Cancel (keep playlist) from dismissal by checking the return value.
    // There is no reliable way to detect dialog dismissal vs. cancel in all browsers via
    // window.confirm alone, so we treat both false cases consistently per spec:
    // OK → deletePlaylist: true, Cancel → deletePlaylist: false, and if somehow neither
    // (impossible with confirm) → do nothing. The spec says "If user closes: do nothing",
    // so we add a separate prompt to confirm the disconnect at all first.
    const wantsToDisconnect = window.confirm(
      confirmed
        ? "Disconnect Yoto and delete the Penni Pig playlist?"
        : "Disconnect Yoto? The playlist will remain in your Yoto library."
    );

    if (!wantsToDisconnect) return;

    setLoading(true);
    try {
      const res = await fetch("/api/yoto/connection", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletePlaylist: confirmed }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMessage(extractErrorMessage(body));
      } else {
        setErrorMessage(null);
        await fetchStatus();
      }
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = () => {
    alert("Preview coming soon");
  };

  const status = statusData?.status ?? null;

  return (
    <>
      {/* Keyframe for spinner — injected once */}
      <style>{`@keyframes yoto-spin { to { transform: rotate(360deg); } }`}</style>

      <main className="settings-page">
        <div className="settings-panel">
          <header className="settings-header">
            <div>
              <p className="eyebrow">Penni Oinkbank</p>
              <h1>Yoto</h1>
            </div>
            <Link className="settings-back" href="/settings" aria-label="Back to settings">
              ← Settings
            </Link>
          </header>

          {errorMessage && (
            <ErrorBanner
              message={errorMessage}
              onDismiss={() => setErrorMessage(null)}
            />
          )}

          {status === null && !errorMessage && (
            <div className="settings-section" style={{ alignItems: "center", textAlign: "center" }}>
              <Spinner />
              <p className="settings-desc" style={{ margin: 0 }}>Loading…</p>
            </div>
          )}

          {status === "not_connected" && <NotConnectedPanel />}

          {status === "connecting" && (
            errorMessage ? (
              <NotConnectedPanel />
            ) : (
              <ConnectingPanel />
            )
          )}

          {status === "connected_no_playlist" && (
            <ConnectedNoPlaylistPanel
              onCreatePlaylist={handleCreatePlaylist}
              loading={loading}
            />
          )}

          {status === "playlist_ready" && (
            <PlaylistReadyPanel onPreview={handlePreview} />
          )}

          {status === "ready" && statusData && (
            <ReadyPanel
              balanceMode={statusData.balanceMode ?? "hidden"}
              onRegenerate={handleRegenerate}
              onDisconnect={handleDisconnect}
              onSaveBalanceMode={handleSaveBalanceMode}
              loading={loading}
            />
          )}

          {status === "needs_attention" && <NeedsAttentionPanel />}
        </div>
      </main>
    </>
  );
}
