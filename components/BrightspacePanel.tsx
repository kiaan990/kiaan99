"use client";

import { useEffect, useRef, useState } from "react";
import { format, isPast, isToday, parseISO } from "date-fns";
import { Plus, RefreshCw, AlertCircle, CheckCircle, Clock, Trash2 } from "lucide-react";

const CALENDAR_COLORS = [
  { label: "Red",    hex: "#e74c3c" },
  { label: "Purple", hex: "#8e44ad" },
  { label: "Amber",  hex: "#e67e22" },
  { label: "Green",  hex: "#27ae60" },
  { label: "Blue",   hex: "#2980b9" },
  { label: "Yellow", hex: "#f1c40f" },
  { label: "Gold",   hex: "#c8922a" },
  { label: "Teal",   hex: "#16a085" },
];

function ColorDot({
  courseId,
  color,
  onColorChange,
}: {
  courseId: string;
  color: string;
  onColorChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pick = async (e: React.MouseEvent, hex: string) => {
    e.stopPropagation();
    await fetch(`/api/brightspace?type=course&id=${courseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: hex }),
    });
    setOpen(false);
    onColorChange();
  };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="Change color"
        style={{
          width: 12, height: 12, borderRadius: "50%", background: color,
          border: "none", cursor: "pointer", padding: 0, flexShrink: 0,
          boxShadow: open ? `0 0 0 2px var(--color-surface), 0 0 0 3px ${color}` : "none",
          transition: "box-shadow 0.15s ease",
        }}
      />
      {open && (
        <div
          className="animate-fade-in"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20,
            background: "var(--color-surface-2)", border: "1px solid var(--color-border)",
            borderRadius: "10px", padding: "0.6rem", display: "flex",
            flexWrap: "wrap", gap: "0.4rem", width: "160px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ width: "100%", fontSize: "0.6rem", color: "var(--color-text-faint)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.2rem" }}>
            Match calendar
          </div>
          {CALENDAR_COLORS.map((c) => (
            <button
              key={c.hex}
              title={c.label}
              onClick={(e) => pick(e, c.hex)}
              style={{
                width: 20, height: 20, borderRadius: "50%", background: c.hex,
                border: `2px solid ${color === c.hex ? "white" : "transparent"}`,
                cursor: "pointer", padding: 0, transition: "transform 0.1s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.2)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface Assignment {
  id: string;
  courseId: string;
  title: string;
  dueDate: string | null;
  submitted: boolean;
  grade: number | null;
  maxGrade: number | null;
  status: "pending" | "submitted" | "graded" | "missing";
}

interface Course {
  id: string;
  name: string;
  courseCode: string | null;
  color: string;
  assignments: Assignment[];
}

const STATUS_CONFIG = {
  pending: { icon: Clock, color: "var(--color-text-muted)", label: "Pending" },
  submitted: { icon: CheckCircle, color: "#3d9970", label: "Submitted" },
  graded: { icon: CheckCircle, color: "var(--color-gold)", label: "Graded" },
  missing: { icon: AlertCircle, color: "var(--color-error)", label: "Missing" },
};

function AddCourseForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [color, setColor] = useState("#c8922a");
  const [loading, setLoading] = useState(false);

  const PRESET_COLORS = ["#c8922a", "#3d9970", "#2980b9", "#8e44ad", "#c0392b", "#16a085"];

  const submit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await fetch("/api/brightspace?type=course", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), courseCode: code.trim() || undefined, color }),
    });
    setName(""); setCode(""); setColor("#c8922a");
    setOpen(false); setLoading(false);
    onAdded();
  };

  if (!open) {
    return (
      <button
        className="btn-ghost"
        onClick={() => setOpen(true)}
        style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
      >
        <Plus size={13} /> Add course
      </button>
    );
  }

  return (
    <div className="card-elevated animate-fade-in" style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input className="input" placeholder="Course name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 2 }} />
        <input className="input" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
        <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>Color:</span>
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            style={{
              width: 18, height: 18, borderRadius: "50%", background: c, border: `2px solid ${color === c ? "var(--color-text)" : "transparent"}`, cursor: "pointer",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="btn-gold" onClick={submit} disabled={loading || !name.trim()}>
          {loading ? "Adding…" : "Add"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function AddAssignmentForm({ courseId, onAdded }: { courseId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<Assignment["status"]>("pending");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setLoading(true);
    await fetch("/api/brightspace?type=assignment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, title: title.trim(), dueDate: dueDate || null, status, submitted: status === "submitted" || status === "graded" }),
    });
    setTitle(""); setDueDate(""); setStatus("pending");
    setOpen(false); setLoading(false);
    onAdded();
  };

  if (!open) {
    return (
      <button
        className="btn-icon"
        onClick={() => setOpen(true)}
        title="Add assignment"
        style={{ padding: "0.2rem 0.4rem", fontSize: "0.65rem" }}
      >
        <Plus size={11} />
      </button>
    );
  }

  return (
    <div className="card-elevated animate-fade-in" style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
      <input className="input" placeholder="Assignment title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input type="datetime-local" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ flex: 1 }} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as Assignment["status"])} style={{ flex: 1 }}>
          <option value="pending">Pending</option>
          <option value="submitted">Submitted</option>
          <option value="graded">Graded</option>
          <option value="missing">Missing</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="btn-gold" onClick={submit} disabled={loading || !title.trim()}>
          {loading ? "Adding…" : "Add"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function AssignmentRow({ a, onUpdate }: { a: Assignment; onUpdate: () => void }) {
  const cfg = STATUS_CONFIG[a.status];
  const Icon = cfg.icon;
  const isDue = a.dueDate && isToday(parseISO(a.dueDate));
  const isOverdue = a.dueDate && isPast(parseISO(a.dueDate)) && !isToday(parseISO(a.dueDate)) && a.status === "pending";

  const toggleSubmit = async () => {
    const newStatus = a.submitted ? "pending" : "submitted";
    await fetch(`/api/brightspace?type=assignment&id=${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submitted: !a.submitted, status: newStatus }),
    });
    onUpdate();
  };

  const deleteA = async () => {
    await fetch(`/api/brightspace?type=assignment&id=${a.id}`, { method: "DELETE" });
    onUpdate();
  };

  return (
    <div
      className="animate-fade-in"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.45rem 0",
        borderBottom: "1px solid var(--color-border-subtle)",
        opacity: a.status === "submitted" || a.status === "graded" ? 0.6 : 1,
      }}
    >
      <button className="btn-icon" onClick={toggleSubmit} style={{ padding: "0.1rem", flexShrink: 0 }}>
        <Icon size={13} style={{ color: cfg.color }} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: "0.8rem",
            color: "var(--color-text)",
            textDecoration: (a.status === "submitted" || a.status === "graded") ? "line-through" : "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "block",
          }}
        >
          {a.title}
        </span>
        {a.dueDate && (
          <span
            style={{
              fontSize: "0.65rem",
              color: isOverdue ? "var(--color-error)" : isDue ? "var(--color-warning)" : "var(--color-text-faint)",
            }}
          >
            Due {format(parseISO(a.dueDate), "MMM d, h:mm a")}
            {isOverdue && " — Overdue"}
            {isDue && " — Today"}
          </span>
        )}
      </div>

      {a.grade !== null && a.maxGrade !== null && (
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            fontFamily: "var(--font-geist-mono)",
            color: "var(--color-gold)",
            flexShrink: 0,
          }}
        >
          {a.grade}/{a.maxGrade}
        </span>
      )}

      <button className="btn-icon" onClick={deleteA} style={{ flexShrink: 0 }}>
        <Trash2 size={11} />
      </button>
    </div>
  );
}

export default function BrightspacePanel() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/brightspace");
    const data = await res.json();
    setCourses(data.courses ?? []);
    setLoading(false);
    if (!expanded && data.courses?.[0]) setExpanded(data.courses[0].id);
  };

  useEffect(() => { load(); }, []);

  const triggerScrape = async () => {
    setScraping(true);
    setScrapeError(null);
    const res = await fetch("/api/brightspace?type=scrape", { method: "POST" });
    setScraping(false);
    if (!res.ok) {
      const d = await res.json();
      setScrapeError(d.error ?? "Scrape failed");
      return;
    }
    load();
  };

  const deleteCourse = async (id: string) => {
    await fetch(`/api/brightspace?type=course&id=${id}`, { method: "DELETE" });
    load();
  };

  const upcoming = courses
    .flatMap((c) => c.assignments.map((a) => ({ ...a, courseName: c.name, courseColor: c.color })))
    .filter((a) => a.status === "pending" && a.dueDate)
    .sort((a, b) => {
      if (!a.dueDate || !b.dueDate) return 0;
      return parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime();
    })
    .slice(0, 3);

  return (
    <div className="card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem", height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span className="section-label">Brightspace</span>
          <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginTop: "0.15rem" }}>
            brightspace.bentley.edu
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            className="btn-ghost"
            onClick={triggerScrape}
            disabled={scraping}
            style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.72rem" }}
          >
            <RefreshCw size={12} className={scraping ? "animate-spin" : ""} />
            {scraping ? "Syncing…" : "Sync"}
          </button>
        </div>
      </div>

      {scrapeError && (
        <div
          style={{
            padding: "0.6rem 0.75rem",
            background: "rgba(192,57,43,0.08)",
            border: "1px solid rgba(192,57,43,0.2)",
            borderRadius: "8px",
            fontSize: "0.75rem",
            color: "var(--color-error)",
          }}
        >
          {scrapeError.includes("BRIGHTSPACE_USER")
            ? "Add BRIGHTSPACE_USER and BRIGHTSPACE_PASS to .env.local to enable auto-sync."
            : scrapeError}
        </div>
      )}

      {/* Upcoming deadlines strip */}
      {upcoming.length > 0 && (
        <div>
          <div className="section-label" style={{ marginBottom: "0.5rem" }}>Next Up</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {upcoming.map((a) => (
              <div
                key={a.id}
                className="animate-fade-in"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.4rem 0.6rem",
                  borderRadius: "7px",
                  background: "var(--color-surface-2)",
                  borderLeft: `3px solid ${a.courseColor}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.78rem", color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                  <div style={{ fontSize: "0.65rem", color: "var(--color-text-muted)" }}>{a.courseName}</div>
                </div>
                <span
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: 600,
                    color: isToday(parseISO(a.dueDate!)) ? "var(--color-warning)" : "var(--color-text-muted)",
                    flexShrink: 0,
                  }}
                >
                  {isToday(parseISO(a.dueDate!)) ? "Today" : format(parseISO(a.dueDate!), "MMM d")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="divider" style={{ margin: 0 }} />

      {/* Courses */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {loading ? (
          <span style={{ fontSize: "0.8rem", color: "var(--color-text-faint)" }}>Loading…</span>
        ) : courses.length === 0 ? (
          <div style={{ padding: "1rem", textAlign: "center", color: "var(--color-text-faint)", fontSize: "0.8rem" }}>
            Add your courses below
          </div>
        ) : (
          courses.map((course) => (
            <div key={course.id}>
              <button
                onClick={() => setExpanded(expanded === course.id ? null : course.id)}
                style={{
                  width: "100%",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.4rem 0.5rem",
                  borderRadius: "7px",
                  textAlign: "left",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                <ColorDot courseId={course.id} color={course.color} onColorChange={load} />
                <span style={{ flex: 1, fontSize: "0.82rem", fontWeight: 500, color: "var(--color-text)" }}>
                  {course.courseCode ? `${course.courseCode} — ` : ""}{course.name}
                </span>
                <span className="badge badge-surface">
                  {course.assignments.filter((a) => a.status === "pending").length} pending
                </span>
                <button
                  className="btn-icon"
                  onClick={(e) => { e.stopPropagation(); deleteCourse(course.id); }}
                  style={{ padding: "0.1rem" }}
                >
                  <Trash2 size={11} />
                </button>
              </button>

              {expanded === course.id && (
                <div
                  className="animate-fade-in"
                  style={{
                    padding: "0.25rem 0.5rem 0.5rem 1.25rem",
                    borderLeft: `2px solid ${course.color}`,
                    marginLeft: "0.75rem",
                  }}
                >
                  {course.assignments.length === 0 ? (
                    <p style={{ fontSize: "0.75rem", color: "var(--color-text-faint)", padding: "0.4rem 0" }}>
                      No assignments
                    </p>
                  ) : (
                    course.assignments.map((a) => (
                      <AssignmentRow key={a.id} a={a} onUpdate={load} />
                    ))
                  )}
                  <AddAssignmentForm courseId={course.id} onAdded={load} />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <AddCourseForm onAdded={load} />
    </div>
  );
}
