"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { RefreshCw, Zap, Clock, BookOpen, AlertTriangle, CheckCircle } from "lucide-react";
import type { BriefResponse, BriefItem, ScheduleEntry } from "@/app/api/brief/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function urgencyColor(daysUntilDue: number): string {
  if (daysUntilDue <= 0) return "var(--color-error)";
  if (daysUntilDue === 1) return "#e67e22";
  if (daysUntilDue <= 3) return "var(--color-gold)";
  return "var(--color-text-muted)";
}

function dueDateLabel(daysUntilDue: number, dueDate: string): string {
  if (daysUntilDue < 0) return `${Math.abs(daysUntilDue)}d overdue`;
  if (daysUntilDue === 0) return "Due today";
  if (daysUntilDue === 1) return "Due tomorrow";
  return `Due ${format(parseISO(dueDate), "MMM d")}`;
}

function typeIcon(type: string): string {
  switch (type) {
    case "exam": return "📝";
    case "quiz": return "❓";
    case "reading": return "📖";
    case "project": return "🗂";
    default: return "📌";
  }
}

function hoursLabel(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

function weightLabel(w: number): string {
  return `${Math.round(w * 100)}%`;
}

// ─── Work On Now card ─────────────────────────────────────────────────────────

function WorkOnNow({ item, overdue }: { item: BriefItem | null; overdue: BriefItem[] }) {
  const hasOverdue = overdue.length > 0;

  if (!item && !hasOverdue) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "0.5rem", padding: "1rem" }}>
        <CheckCircle size={20} style={{ color: "#27ae60" }} />
        <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", textAlign: "center" }}>
          All caught up
        </span>
      </div>
    );
  }

  const focus = item ?? overdue[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <Zap size={13} style={{ color: "var(--color-gold)", flexShrink: 0 }} />
        <span className="section-label">Work on now</span>
      </div>

      {hasOverdue && (
        <div style={{
          padding: "0.35rem 0.55rem",
          background: "rgba(192,57,43,0.08)",
          border: "1px solid rgba(192,57,43,0.2)",
          borderRadius: "7px",
          fontSize: "0.7rem",
          color: "var(--color-error)",
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
        }}>
          <AlertTriangle size={11} />
          {overdue.length} overdue item{overdue.length > 1 ? "s" : ""}
        </div>
      )}

      <div
        style={{
          background: "rgba(200,146,42,0.06)",
          border: "1px solid rgba(200,146,42,0.2)",
          borderRadius: "10px",
          padding: "0.75rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.4rem",
          flex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.9rem", lineHeight: 1 }}>{typeIcon(focus.type)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: "0.82rem",
              fontWeight: 600,
              color: "var(--color-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {focus.title}
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--color-text-muted)", marginTop: "0.1rem" }}>
              {focus.courseCode ?? focus.courseName}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <span className="badge" style={{
            background: "rgba(200,146,42,0.12)",
            color: "var(--color-gold)",
            fontSize: "0.62rem",
          }}>
            {weightLabel(focus.weight)} of grade
          </span>
          <span className="badge badge-surface" style={{ fontSize: "0.62rem", color: urgencyColor(focus.daysUntilDue) }}>
            {dueDateLabel(focus.daysUntilDue, focus.dueDate)}
          </span>
        </div>

        <div style={{
          marginTop: "auto",
          paddingTop: "0.4rem",
          borderTop: "1px solid rgba(200,146,42,0.12)",
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
        }}>
          <Clock size={11} style={{ color: "var(--color-gold)" }} />
          <span style={{ fontSize: "0.72rem", color: "var(--color-gold)", fontWeight: 600 }}>
            Start with {hoursLabel(focus.estimatedHours)} today
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Upcoming items card ───────────────────────────────────────────────────────

function UpcomingCard({ items }: { items: BriefItem[] }) {
  const today = items.filter((i) => i.daysUntilDue === 0);
  const soon = items.filter((i) => i.daysUntilDue > 0 && i.daysUntilDue <= 3);
  const later = items.filter((i) => i.daysUntilDue > 3);

  const Section = ({ label, list }: { label: string; list: BriefItem[] }) => {
    if (list.length === 0) return null;
    return (
      <div>
        <div style={{ fontSize: "0.6rem", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.3rem" }}>
          {label}
        </div>
        {list.map((item) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0.3rem 0",
              borderBottom: "1px solid var(--color-border-subtle)",
            }}
          >
            <div
              style={{
                width: 3,
                height: 28,
                borderRadius: 2,
                background: item.courseColor,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: "0.78rem",
                color: "var(--color-text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {typeIcon(item.type)} {item.title}
              </div>
              <div style={{ fontSize: "0.63rem", color: "var(--color-text-faint)" }}>
                {item.courseCode ?? item.courseName}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: "0.68rem", color: urgencyColor(item.daysUntilDue), fontWeight: 500 }}>
                {dueDateLabel(item.daysUntilDue, item.dueDate)}
              </div>
              <div style={{ fontSize: "0.6rem", color: "var(--color-text-faint)" }}>
                ~{hoursLabel(item.estimatedHours)}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (items.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <BookOpen size={13} style={{ color: "var(--color-text-muted)" }} />
          <span className="section-label">Due this week</span>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--color-text-faint)" }}>Nothing due this week</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <BookOpen size={13} style={{ color: "var(--color-text-muted)" }} />
        <span className="section-label">Due this week</span>
        <span className="badge badge-surface" style={{ fontSize: "0.6rem", marginLeft: "auto" }}>
          {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <Section label="Today" list={today} />
        <Section label="Next 3 days" list={soon} />
        <Section label="This week" list={later} />
      </div>
    </div>
  );
}

// ─── Today's schedule card ────────────────────────────────────────────────────

function ScheduleCard({ entries }: { entries: ScheduleEntry[] }) {
  function fmt12(t: string): string {
    const [h, m] = t.split(":").map(Number);
    const period = h >= 12 ? "pm" : "am";
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
  }

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const isActive = (entry: ScheduleEntry) => {
    const [sh, sm] = entry.startTime.split(":").map(Number);
    const [eh, em] = entry.endTime.split(":").map(Number);
    return nowMin >= sh * 60 + sm && nowMin <= eh * 60 + em;
  };

  const isPast = (entry: ScheduleEntry) => {
    const [eh, em] = entry.endTime.split(":").map(Number);
    return nowMin > eh * 60 + em;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <Clock size={13} style={{ color: "var(--color-text-muted)" }} />
        <span className="section-label">Today&apos;s classes</span>
        <span style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", marginLeft: "auto" }}>
          {format(now, "EEEE")}
        </span>
      </div>

      {entries.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--color-text-faint)" }}>No classes today</span>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {entries.map((entry, i) => {
            const active = isActive(entry);
            const past = isPast(entry);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: "0.6rem",
                  alignItems: "flex-start",
                  padding: "0.45rem 0.55rem",
                  borderRadius: "8px",
                  background: active ? "rgba(200,146,42,0.07)" : "var(--color-surface-2)",
                  border: `1px solid ${active ? "rgba(200,146,42,0.25)" : "transparent"}`,
                  opacity: past ? 0.45 : 1,
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ flexShrink: 0, textAlign: "right", minWidth: 48 }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: active ? "var(--color-gold)" : "var(--color-text)", fontFamily: "var(--font-geist-mono)" }}>
                    {fmt12(entry.startTime)}
                  </div>
                  <div style={{ fontSize: "0.62rem", color: "var(--color-text-faint)" }}>
                    {fmt12(entry.endTime)}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--color-text)" }}>
                    {entry.courseCode ?? entry.courseName}
                  </div>
                  {entry.location && (
                    <div style={{ fontSize: "0.65rem", color: "var(--color-text-muted)", marginTop: "0.1rem" }}>
                      {entry.location}
                    </div>
                  )}
                  {entry.professor && (
                    <div style={{ fontSize: "0.62rem", color: "var(--color-text-faint)" }}>
                      {entry.professor}
                    </div>
                  )}
                </div>
                {active && (
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-gold)", boxShadow: "0 0 6px var(--color-gold)", flexShrink: 0, marginTop: 3 }} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function DailyBriefPanel() {
  const [data, setData] = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch("/api/brief");
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const CARD_STYLE: React.CSSProperties = {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "0.875rem 1rem",
    flex: 1,
    minWidth: 0,
    minHeight: 180,
    display: "flex",
    flexDirection: "column",
  };

  if (loading) {
    return (
      <div style={{ display: "flex", gap: "1rem", padding: "0 1.25rem" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ ...CARD_STYLE, background: "var(--color-surface)" }}>
            <div style={{ height: "0.7rem", width: "40%", background: "var(--color-surface-2)", borderRadius: 4, marginBottom: "0.75rem" }} />
            <div style={{ height: "0.75rem", width: "80%", background: "var(--color-surface-2)", borderRadius: 4, marginBottom: "0.4rem" }} />
            <div style={{ height: "0.75rem", width: "60%", background: "var(--color-surface-2)", borderRadius: 4 }} />
          </div>
        ))}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: "1rem",
        padding: "0 1.25rem",
        alignItems: "stretch",
      }}
    >
      {/* Work on now */}
      <div style={{ ...CARD_STYLE, flex: "0 0 260px" }}>
        <WorkOnNow item={data.workOnNow} overdue={data.overdue} />
      </div>

      {/* Due this week */}
      <div style={{ ...CARD_STYLE }}>
        <UpcomingCard items={data.upcoming} />
      </div>

      {/* Today's schedule */}
      <div style={{ ...CARD_STYLE, flex: "0 0 240px" }}>
        <ScheduleCard entries={data.todaySchedule} />
      </div>

      {/* Refresh button */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start", paddingTop: "0.5rem" }}>
        <button
          className="btn-icon"
          onClick={() => load(true)}
          disabled={refreshing}
          title="Refresh brief"
          style={{ padding: "0.4rem" }}
        >
          <RefreshCw size={13} style={{ animation: refreshing ? "spin 1.2s linear infinite" : "none" }} />
        </button>
      </div>
    </div>
  );
}
