"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Mail, Star, ExternalLink } from "lucide-react";
import { format, parseISO } from "date-fns";

interface EmailMessage {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  isRead: boolean;
  isImportant: boolean;
  preview: string;
}

interface AccountData {
  status: "connected" | "unauthenticated" | "unconfigured" | "error";
  unreadCount?: number;
  messages?: EmailMessage[];
  error?: string;
}

function ConnectPrompt({
  provider,
  connectUrl,
  envVars,
}: {
  provider: string;
  connectUrl: string;
  envVars: string[];
}) {
  return (
    <div
      className="card-elevated"
      style={{ padding: "0.875rem", fontSize: "0.78rem", lineHeight: 1.6 }}
    >
      <div style={{ fontWeight: 600, color: "var(--color-text)", marginBottom: "0.3rem" }}>
        {provider} not connected
      </div>
      <div style={{ color: "var(--color-text-muted)", marginBottom: "0.6rem" }}>
        Add to <code style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.7rem" }}>.env.local</code>:
      </div>
      <code
        style={{
          fontFamily: "var(--font-geist-mono)",
          fontSize: "0.68rem",
          color: "var(--color-text-muted)",
          display: "block",
          lineHeight: 1.8,
          marginBottom: "0.6rem",
        }}
      >
        {envVars.map((v) => <span key={v} style={{ display: "block" }}>{v}</span>)}
      </code>
      <a
        href={connectUrl}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          fontSize: "0.75rem",
          color: "var(--color-gold-light)",
          textDecoration: "none",
        }}
      >
        Connect {provider} <ExternalLink size={11} />
      </a>
    </div>
  );
}

function MessageRow({ msg }: { msg: EmailMessage }) {
  let dateStr = "";
  try {
    dateStr = format(parseISO(msg.receivedAt), "h:mm a");
  } catch {
    dateStr = msg.receivedAt?.slice(0, 10) ?? "";
  }

  return (
    <div
      style={{
        padding: "0.5rem 0",
        borderBottom: "1px solid var(--color-border-subtle)",
        display: "flex",
        gap: "0.6rem",
        alignItems: "flex-start",
      }}
    >
      <div style={{ flexShrink: 0, marginTop: "2px" }}>
        {msg.isImportant ? (
          <Star size={12} style={{ color: "var(--color-gold)" }} fill="var(--color-gold)" />
        ) : (
          <Mail size={12} style={{ color: msg.isRead ? "var(--color-text-faint)" : "var(--color-text-muted)" }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.78rem",
              fontWeight: msg.isRead ? 400 : 600,
              color: "var(--color-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {msg.subject}
          </span>
          <span style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", flexShrink: 0 }}>
            {dateStr}
          </span>
        </div>
        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--color-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginTop: "0.1rem",
          }}
        >
          {msg.from}
        </div>
        {msg.preview && (
          <div
            style={{
              fontSize: "0.68rem",
              color: "var(--color-text-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: "0.1rem",
            }}
          >
            {msg.preview}
          </div>
        )}
      </div>
    </div>
  );
}

function AccountSection({
  provider,
  data,
  isPrimary,
}: {
  provider: "outlook" | "gmail";
  data: AccountData | null;
  isPrimary: boolean;
}) {
  const label = provider === "outlook" ? "Outlook" : "Gmail";
  const connectUrl = `/api/email/${provider}?action=connect`;
  const envVars =
    provider === "outlook"
      ? [
          "MICROSOFT_CLIENT_ID=your-client-id",
          "MICROSOFT_CLIENT_SECRET=your-secret",
          "MICROSOFT_TENANT_ID=common",
          "NEXTAUTH_URL=http://localhost:3000",
        ]
      : [
          "GOOGLE_CLIENT_ID=your-client-id",
          "GOOGLE_CLIENT_SECRET=your-secret",
          "NEXTAUTH_URL=http://localhost:3000",
        ];

  if (!data || data.status === "unconfigured") {
    return (
      <ConnectPrompt provider={label} connectUrl={connectUrl} envVars={envVars} />
    );
  }

  if (data.status === "unauthenticated") {
    return (
      <div style={{ textAlign: "center", padding: "0.75rem 0" }}>
        <a href={connectUrl} className="btn-gold" style={{ display: "inline-block" }}>
          Connect {label}
        </a>
      </div>
    );
  }

  if (data.status === "error") {
    return (
      <div style={{ fontSize: "0.75rem", color: "var(--color-error)", padding: "0.5rem 0" }}>
        {data.error ?? "Failed to load"}
      </div>
    );
  }

  const messages = data.messages ?? [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text)" }}>
          {label}
        </span>
        {isPrimary && <span className="badge badge-gold">Primary</span>}
        {(data.unreadCount ?? 0) > 0 && (
          <span className="badge badge-surface" style={{ marginLeft: "auto" }}>
            {data.unreadCount} unread
          </span>
        )}
      </div>
      <div className="stagger">
        {messages.length === 0 ? (
          <p style={{ fontSize: "0.75rem", color: "var(--color-text-faint)", padding: "0.5rem 0" }}>
            Inbox is empty
          </p>
        ) : (
          messages.map((m) => <MessageRow key={m.id} msg={m} />)
        )}
      </div>
    </div>
  );
}

export default function EmailPanel() {
  const [outlook, setOutlook] = useState<AccountData | null>(null);
  const [gmail, setGmail] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<"outlook" | "gmail" | null>("outlook");

  const load = async () => {
    setRefreshing(true);
    const [oRes, gRes] = await Promise.all([
      fetch("/api/email/outlook"),
      fetch("/api/email/gmail"),
    ]);
    const [oData, gData] = await Promise.all([oRes.json(), gRes.json()]);
    setOutlook(oData);
    setGmail(gData);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  const totalUnread =
    (outlook?.unreadCount ?? 0) + (gmail?.unreadCount ?? 0);

  return (
    <div
      className="card"
      style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span className="section-label">Inbox</span>
          {totalUnread > 0 && (
            <div style={{ marginTop: "0.2rem" }}>
              <span style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--color-text)" }}>
                {totalUnread}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginLeft: "0.4rem" }}>
                unread
              </span>
            </div>
          )}
        </div>
        <button className="btn-icon" onClick={load} disabled={refreshing} title="Refresh">
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: "0.8rem", color: "var(--color-text-faint)" }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Outlook (Primary) */}
          <div>
            <button
              onClick={() => setExpanded(expanded === "outlook" ? null : "outlook")}
              style={{
                background: "none",
                border: "none",
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                padding: "0 0 0.5rem 0",
                borderBottom: "1px solid var(--color-border)",
                marginBottom: "0.5rem",
                color: "var(--color-text-muted)",
                fontSize: "0.72rem",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>Outlook</span>
              <span style={{ fontSize: "0.65rem" }}>{expanded === "outlook" ? "▲" : "▼"}</span>
            </button>
            {expanded === "outlook" && (
              <AccountSection provider="outlook" data={outlook} isPrimary />
            )}
          </div>

          {/* Divider */}
          <div className="divider" style={{ margin: 0 }} />

          {/* Gmail (Secondary) */}
          <div>
            <button
              onClick={() => setExpanded(expanded === "gmail" ? null : "gmail")}
              style={{
                background: "none",
                border: "none",
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                padding: "0 0 0.5rem 0",
                borderBottom: "1px solid var(--color-border)",
                marginBottom: "0.5rem",
                color: "var(--color-text-muted)",
                fontSize: "0.72rem",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>Gmail</span>
              <span style={{ fontSize: "0.65rem" }}>{expanded === "gmail" ? "▲" : "▼"}</span>
            </button>
            {expanded === "gmail" && (
              <AccountSection provider="gmail" data={gmail} isPrimary={false} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
