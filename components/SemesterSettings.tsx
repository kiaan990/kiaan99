"use client";

import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { Settings, X, Plus, Check, Trash2, ChevronDown, ChevronUp } from "lucide-react";

interface SemesterBreak {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

interface Semester {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  breaks: SemesterBreak[];
}

function NewSemesterForm({ onCreated }: { onCreated: () => void }) {
  const currentYear = new Date().getFullYear();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [makeActive, setMakeActive] = useState(true);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim() || !startDate || !endDate) return;
    setLoading(true);
    await fetch("/api/semester", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), startDate, endDate, isActive: makeActive }),
    });
    setLoading(false);
    onCreated();
  };

  return (
    <div className="card-elevated animate-fade-in" style={{ padding: "0.875rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        New semester
      </div>
      <input
        className="input"
        placeholder={`e.g. Fall ${currentYear}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", marginBottom: "0.2rem" }}>Start</div>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", marginBottom: "0.2rem" }}>End</div>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
        <input
          type="checkbox"
          className="checkbox"
          checked={makeActive}
          onChange={(e) => setMakeActive(e.target.checked)}
        />
        Set as active semester
      </label>
      <button
        className="btn-gold"
        onClick={submit}
        disabled={loading || !name.trim() || !startDate || !endDate}
        style={{ alignSelf: "flex-start" }}
      >
        {loading ? "Creating…" : "Create semester"}
      </button>
    </div>
  );
}

function AddBreakForm({ semesterId, onAdded }: { semesterId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim() || !startDate || !endDate) return;
    setLoading(true);
    await fetch("/api/semester?type=break", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ semesterId, name: name.trim(), startDate, endDate }),
    });
    setName(""); setStartDate(""); setEndDate("");
    setOpen(false); setLoading(false);
    onAdded();
  };

  if (!open) {
    return (
      <button
        className="btn-ghost"
        onClick={() => setOpen(true)}
        style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.7rem" }}
      >
        <Plus size={11} /> Add break
      </button>
    );
  }

  return (
    <div className="card-elevated animate-fade-in" style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <input className="input" placeholder="e.g. Thanksgiving Break" value={name} onChange={(e) => setName(e.target.value)} />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ flex: 1 }} />
        <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="btn-gold" onClick={submit} disabled={loading || !name.trim() || !startDate || !endDate}>
          {loading ? "Adding…" : "Add"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function SemesterRow({ sem, onRefresh }: { sem: Semester; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [activating, setActivating] = useState(false);

  const activate = async () => {
    setActivating(true);
    await fetch(`/api/semester?id=${sem.id}&type=activate`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    setActivating(false);
    onRefresh();
  };

  const deleteSem = async () => {
    if (!confirm(`Archive "${sem.name}"? Courses will remain but won't be linked to this semester.`)) return;
    await fetch(`/api/semester?id=${sem.id}`, { method: "DELETE" });
    onRefresh();
  };

  const deleteBreak = async (breakId: string) => {
    await fetch(`/api/semester?id=${breakId}&type=break`, { method: "DELETE" });
    onRefresh();
  };

  return (
    <div
      style={{
        background: sem.isActive ? "rgba(200,146,42,0.06)" : "var(--color-surface-2)",
        border: `1px solid ${sem.isActive ? "rgba(200,146,42,0.25)" : "var(--color-border)"}`,
        borderRadius: "10px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          padding: "0.65rem 0.75rem",
        }}
      >
        {sem.isActive && (
          <Check size={12} style={{ color: "var(--color-gold)", flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--color-text)" }}>
            {sem.name}
            {sem.isActive && (
              <span className="badge badge-gold" style={{ marginLeft: "0.5rem", fontSize: "0.6rem" }}>
                Active
              </span>
            )}
          </div>
          <div style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", marginTop: "0.1rem" }}>
            {format(parseISO(sem.startDate), "MMM d, yyyy")} – {format(parseISO(sem.endDate), "MMM d, yyyy")}
            {sem.breaks.length > 0 && ` · ${sem.breaks.length} break${sem.breaks.length > 1 ? "s" : ""}`}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          {!sem.isActive && (
            <button
              className="btn-ghost"
              onClick={activate}
              disabled={activating}
              style={{ fontSize: "0.7rem" }}
            >
              {activating ? "Activating…" : "Set active"}
            </button>
          )}
          <button
            className="btn-icon"
            onClick={() => setExpanded((e) => !e)}
            title="Breaks"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {!sem.isActive && (
            <button className="btn-icon" onClick={deleteSem} title="Archive semester">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div
          className="animate-fade-in"
          style={{
            borderTop: "1px solid var(--color-border-subtle)",
            padding: "0.6rem 0.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
          }}
        >
          <div style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.2rem" }}>
            Breaks / Holidays
          </div>
          {sem.breaks.length === 0 && (
            <div style={{ fontSize: "0.75rem", color: "var(--color-text-faint)" }}>No breaks added</div>
          )}
          {sem.breaks.map((b) => (
            <div
              key={b.id}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.3rem 0" }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.78rem", color: "var(--color-text)" }}>{b.name}</div>
                <div style={{ fontSize: "0.63rem", color: "var(--color-text-faint)" }}>
                  {format(parseISO(b.startDate), "MMM d")} – {format(parseISO(b.endDate), "MMM d")}
                </div>
              </div>
              <button className="btn-icon" onClick={() => deleteBreak(b.id)}>
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <AddBreakForm semesterId={sem.id} onAdded={onRefresh} />
        </div>
      )}
    </div>
  );
}

export default function SemesterSettings() {
  const [open, setOpen] = useState(false);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [showNewForm, setShowNewForm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    const res = await fetch("/api/semester");
    const data = await res.json();
    setSemesters(data.semesters ?? []);
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeSemester = semesters.find((s) => s.isActive);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-icon"
        title="Semester settings"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          padding: "0.3rem 0.55rem",
          fontSize: "0.7rem",
          color: "var(--color-text-muted)",
        }}
      >
        <Settings size={13} style={{ color: open ? "var(--color-gold)" : undefined }} />
        {activeSemester && (
          <span style={{ fontSize: "0.68rem", color: "var(--color-text-muted)" }}>
            {activeSemester.name}
          </span>
        )}
      </button>

      {open && (
        <div
          className="animate-fade-in"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 50,
            width: 340,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "14px",
            padding: "1rem",
            boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="section-label">Semester</span>
            <button className="btn-icon" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "320px", overflowY: "auto" }}>
            {semesters.length === 0 && (
              <div style={{ fontSize: "0.78rem", color: "var(--color-text-faint)", padding: "0.5rem 0" }}>
                No semesters yet. Create one to get started.
              </div>
            )}
            {semesters.map((sem) => (
              <SemesterRow key={sem.id} sem={sem} onRefresh={load} />
            ))}
          </div>

          {showNewForm ? (
            <div>
              <NewSemesterForm onCreated={() => { setShowNewForm(false); load(); }} />
              <button
                className="btn-ghost"
                onClick={() => setShowNewForm(false)}
                style={{ marginTop: "0.5rem", fontSize: "0.72rem" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="btn-ghost"
              onClick={() => setShowNewForm(true)}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem" }}
            >
              <Plus size={13} /> New semester
            </button>
          )}
        </div>
      )}
    </div>
  );
}
