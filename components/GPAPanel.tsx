"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { GRADE_LABELS, gpaToColor, gpaToLabel } from "@/lib/gpa";

interface GpaCourse {
  id: string;
  name: string;
  courseCode?: string;
  credits: number;
  letterGrade: string;
  semester: string;
}

interface GpaData {
  courses: GpaCourse[];
  gpa: number;
  semesters: string[];
}

const DEFAULT_SEMESTER = (() => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month <= 5 ? `Spring ${year}` : month <= 8 ? `Summer ${year}` : `Fall ${year}`;
})();

function GPARing({ gpa }: { gpa: number }) {
  const color = gpaToColor(gpa);
  const pct = (gpa / 4.0) * 100;
  const r = 40;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <svg width="100" height="100" style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="6"
        />
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          lineHeight: 1,
        }}
      >
        <span
          style={{
            fontSize: "1.3rem",
            fontWeight: 700,
            color,
            fontFamily: "var(--font-geist-mono)",
          }}
        >
          {gpa.toFixed(2)}
        </span>
        <span style={{ fontSize: "0.6rem", color: "var(--color-text-muted)", marginTop: "2px" }}>
          GPA
        </span>
      </div>
    </div>
  );
}

function AddCourseForm({
  semester,
  onAdd,
}: {
  semester: string;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [credits, setCredits] = useState("3");
  const [grade, setGrade] = useState("A");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await fetch("/api/gpa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        courseCode: courseCode.trim() || undefined,
        credits: parseFloat(credits),
        letterGrade: grade,
        semester,
      }),
    });
    setName("");
    setCourseCode("");
    setCredits("3");
    setGrade("A");
    setOpen(false);
    setLoading(false);
    onAdd();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-ghost"
        style={{ width: "100%", display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "center" }}
      >
        <Plus size={13} />
        Add course
      </button>
    );
  }

  return (
    <div className="card-elevated animate-fade-in" style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input className="input" placeholder="Course name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 2 }} />
        <input className="input" placeholder="Code" value={courseCode} onChange={(e) => setCourseCode(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <select className="input" value={grade} onChange={(e) => setGrade(e.target.value)} style={{ flex: 1 }}>
          {GRADE_LABELS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="input" value={credits} onChange={(e) => setCredits(e.target.value)} style={{ flex: 1 }}>
          {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6].map((c) => (
            <option key={c} value={c}>{c} cr</option>
          ))}
        </select>
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

export default function GPAPanel() {
  const [data, setData] = useState<GpaData | null>(null);
  const [semester, setSemester] = useState(DEFAULT_SEMESTER);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async (sem?: string) => {
    const s = sem ?? semester;
    const res = await fetch(`/api/gpa?semester=${encodeURIComponent(s)}`);
    const d = await res.json();
    setData(d);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const deleteCourse = async (id: string) => {
    setDeleting(id);
    await fetch(`/api/gpa?id=${id}`, { method: "DELETE" });
    load();
    setDeleting(null);
  };

  const changeSemester = (s: string) => {
    setSemester(s);
    load(s);
  };

  const gpa = data?.gpa ?? 0;
  const color = gpaToColor(gpa);
  const label = data && data.courses.length > 0 ? gpaToLabel(gpa) : null;

  return (
    <div className="card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="section-label">GPA Tracker</span>
        <select
          className="input"
          style={{ width: "auto", fontSize: "0.7rem", padding: "0.3rem 0.6rem" }}
          value={semester}
          onChange={(e) => changeSemester(e.target.value)}
        >
          {/* Always show current semester */}
          {[DEFAULT_SEMESTER, ...(data?.semesters?.filter((s) => s !== DEFAULT_SEMESTER) ?? [])].map(
            (s) => <option key={s} value={s}>{s}</option>
          )}
        </select>
      </div>

      {/* GPA ring + label */}
      <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
        <GPARing gpa={gpa} />
        <div>
          {label && (
            <div
              className="badge badge-gold"
              style={{ marginBottom: "0.4rem" }}
            >
              {label}
            </div>
          )}
          <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            {data?.courses.length ?? 0} course{data?.courses.length !== 1 ? "s" : ""}
            {data && data.courses.length > 0 && (
              <> · {data.courses.reduce((s, c) => s + c.credits, 0).toFixed(1)} credits</>
            )}
          </div>
        </div>
      </div>

      <div className="divider" style={{ margin: "0" }} />

      {/* Course list */}
      <div
        className="stagger"
        style={{ display: "flex", flexDirection: "column", gap: "0.3rem", overflowY: "auto", maxHeight: "200px" }}
      >
        {loading ? (
          <span style={{ fontSize: "0.8rem", color: "var(--color-text-faint)" }}>Loading…</span>
        ) : data?.courses.length === 0 ? (
          <span style={{ fontSize: "0.8rem", color: "var(--color-text-faint)", textAlign: "center", padding: "0.5rem 0" }}>
            Add your courses below
          </span>
        ) : (
          data?.courses.map((c) => (
            <div
              key={c.id}
              className="animate-fade-in"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.4rem 0.5rem",
                borderRadius: "6px",
                background: "var(--color-surface-2)",
              }}
            >
              <div>
                <span style={{ fontSize: "0.8rem", color: "var(--color-text)" }}>
                  {c.courseCode ? `${c.courseCode} — ` : ""}{c.name}
                </span>
                <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginLeft: "0.4rem" }}>
                  {c.credits}cr
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 700,
                    fontFamily: "var(--font-geist-mono)",
                    color: color,
                  }}
                >
                  {c.letterGrade}
                </span>
                <button
                  className="btn-icon"
                  onClick={() => deleteCourse(c.id)}
                  disabled={deleting === c.id}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <AddCourseForm semester={semester} onAdd={() => load()} />
    </div>
  );
}
