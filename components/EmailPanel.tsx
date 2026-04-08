"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ExternalLink, Sparkles, AlertCircle } from "lucide-react";

interface GmailData {
  status: "connected" | "unauthenticated" | "unconfigured" | "error";
  unreadCount?: number;
  summary?: string;
  actionItems?: { subject: string; from: string; reason: string }[];
  error?: string;
}

interface OutlookData {
  status: "connected" | "unauthenticated" | "unconfigured" | "error";
  unreadCount?: number;
  messages?: { id: string; subject: string; from: string; receivedAt: string; isRead: boolean; isImportant: boolean; preview: string }[];
  error?: string;
}

export default function EmailPanel() {
  const [gmail, setGmail] = useState<GmailData | null>(null);
  const [outlook, setOutlook] = useState<OutlookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    const [gRes, oRes] = await Promise.all([
      fetch("/api/email/gmail"),
      fetch("/api/email/outlook"),
    ]);
    const [gData, oData] = await Promise.all([gRes.json(), oRes.json()]);
    setGmail(gData);
    setOutlook(oData);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  const renderGmail = () => {
    if (!gmail || gmail.status === "unconfigured") {
      return (
        <div style={{ fontSize: "0.75rem", color: "var(--color-text-faint)", padding: "0.25rem 0" }}>
          <a href="/api/email/gmail?action=connect" style={{ color: "var(--color-gold-light)", textDecoration: "none" }}>
            Connect Gmail <ExternalLink size={10} style={{ display: "inline", verticalAlign: "middle" }} />
          </a>
        </div>
      );
    }

    if (gmail.status === "unauthenticated") {
      return (
        <a href="/api/email/gmail?action=connect" className="btn-gold" style={{ display: "inline-block", fontSize: "0.75rem" }}>
          Connect Gmail
        </a>
      );
    }

    if (gmail.status === "error") {
      return (
        <div style={{ fontSize: "0.72rem", color: "var(--color-error)" }}>
          {gmail.error ?? "Failed to load"}
        </div>
      );
    }

    const actionItems = gmail.actionItems ?? [];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {/* Unread count + summary */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
          {(gmail.unreadCount ?? 0) > 0 && (
            <span
              style={{
                fontSize: "0.65rem", padding: "0.15rem 0.45rem",
                borderRadius: "999px",
                background: "rgba(201,168,76,0.1)",
                border: "1px solid var(--color-gold-dim)",
                color: "var(--color-gold-light)",
                flexShrink: 0,
                marginTop: "1px",
              }}
            >
              {gmail.unreadCount} unread
            </span>
          )}
          {gmail.summary && (
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              {gmail.summary}
            </span>
          )}
        </div>

        {/* Action items */}
        {actionItems.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {actionItems.map((item, i) => (
              <div
                key={i}
                style={{
                  padding: "0.5rem 0.65rem",
                  borderRadius: "8px",
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                  display: "flex",
                  gap: "0.5rem",
                  alignItems: "flex-start",
                }}
              >
                <AlertCircle size={11} style={{ color: "var(--color-gold)", flexShrink: 0, marginTop: "2px" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "0.76rem",
                      fontWeight: 600,
                      color: "var(--color-text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.subject}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--color-text-muted)", marginTop: "0.1rem" }}>
                    {item.from} · <span style={{ color: "var(--color-text-faint)" }}>{item.reason}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: "0.75rem", color: "var(--color-text-faint)", padding: "0.25rem 0" }}>
            Nothing urgent in your inbox.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <Sparkles size={12} style={{ color: "var(--color-gold)" }} />
          <span className="section-label">Gmail</span>
        </div>
        <button className="btn-icon" onClick={load} disabled={refreshing} title="Refresh">
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: "0.8rem", color: "var(--color-text-faint)" }}>Summarizing…</div>
      ) : (
        renderGmail()
      )}
    </div>
  );
}
