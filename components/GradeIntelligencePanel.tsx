"use client";

import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import type { GradeIntelligenceResponse, CourseGradeResult } from "@/app/api/grade-intelligence/route";
import type { ComponentGradeResult, ItemGradeResult } from "@/lib/grade-math";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function letterColor(letter: string | null): string {
  if (!letter) return "var(--color-text-muted)";
  if (letter.startsWith("A")) return "#22c55e";
  if (letter.startsWith("B")) return "#f59e0b";
  if (letter.startsWith("C")) return "#f97316";
  return "#ef4444";
}

function gradeBarColor(pct: number): string {
  if (pct >= 90) return "#22c55e";
  if (pct >= 80) return "#f59e0b";
  if (pct >= 70) return "#f97316";
  return "#ef4444";
}

// ─── Score entry inline input ─────────────────────────────────────────────────

function ScoreInput({
  item,
  onSave,
}: {
  item: ItemGradeResult;
  onSave: () => void;
}) {
  const [earned, setEarned] = useState(item.earnedPoints?.toString() ?? "");
  const [max, setMax] = useState(item.maxPoints?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    const e = earned === "" ? null : parseFloat(earned);
    const m = max === "" ? null : parseFloat(max);
    if (e !== null && isNaN(e)) return;
    if (m !== null && isNaN(m)) return;
    setSaving(true);
    await fetch(`/api/syllabus-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ earnedPoints: e, maxPoints: m }),
    });
    setSaving(false);
    onSave();
  }, [earned, max, item.id, onSave]);

  const pct =
    earned !== "" && max !== "" && parseFloat(max) > 0
      ? (parseFloat(earned) / parseFloat(max)) * 100
      : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
        flexShrink: 0,
      }}
    >
      <input
        type="number"
        min="0"
        placeholder="—"
        value={earned}
        onChange={(e) => setEarned(e.target.value)}
        onBlur={save}
        disabled={saving}
        style={{
          width: "44px",
          padding: "0.2rem 0.3rem",
          fontSize: "0.7rem",
          background: "var(--color-surface-2)",
          border: "1px solid var(--color-border)",
          borderRadius: "4px",
          color: "var(--color-text)",
          textAlign: "center",
          fontFamily: "var(--font-geist-mono)",
        }}
      />
      <span style={{ fontSize: "0.65rem", color: "var(--color-text-faint)" }}>/</span>
      <input
        type="number"
        min="0"
        placeholder="100"
        value={max}
        onChange={(e) => setMax(e.target.value)}
        onBlur={save}
        disabled={saving}
        style={{
          width: "44px",
          padding: "0.2rem 0.3rem",
          fontSize: "0.7rem",
          background: "var(--color-surface-2)",
          border: "1px solid var(--color-border)",
          borderRadius: "4px",
          color: "var(--color-text)",
          textAlign: "center",
          fontFamily: "var(--font-geist-mono)",
        }}
      />
      {pct != null && (
        <span
          style={{
            fontSize: "0.65rem",
            fontFamily: "var(--font-geist-mono)",
            color: gradeBarColor(pct),
            width: "32px",
          }}
        >
          {pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

// ─── Component section (expandable) ──────────────────────────────────────────

function ComponentSection({
  comp,
  onSave,
}: {
  comp: ComponentGradeResult;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const gradedItems = comp.items.filter((i) => i.isGraded).length;
  const fraction = comp.earnedFraction;

  return (
    <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "0.4rem" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0.2rem 0",
          gap: "0.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
            {comp.name}
          </span>
          <span style={{ fontSize: "0.65rem", color: "var(--color-text-faint)" }}>
            {(comp.weight * 100).toFixed(0)}%
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.65rem", color: "var(--color-text-faint)" }}>
            {gradedItems}/{comp.items.length} graded
          </span>
          {fraction != null && (
            <span
              style={{
                fontSize: "0.72rem",
                fontFamily: "var(--font-geist-mono)",
                color: gradeBarColor(fraction),
                fontWeight: 600,
              }}
            >
              {fraction.toFixed(1)}%
            </span>
          )}
        </div>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", paddingLeft: "1rem", paddingTop: "0.25rem" }}>
          {comp.items.length === 0 ? (
            <span style={{ fontSize: "0.7rem", color: "var(--color-text-faint)" }}>No items</span>
          ) : (
            comp.items.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                  padding: "0.25rem 0.4rem",
                  borderRadius: "4px",
                  background: item.isGraded ? "var(--color-surface-2)" : "transparent",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--color-text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.title}
                  </div>
                  {item.dueDate && (
                    <div style={{ fontSize: "0.6rem", color: "var(--color-text-faint)" }}>
                      {new Date(item.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                  )}
                </div>
                <ScoreInput item={item} onSave={onSave} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Single course card ───────────────────────────────────────────────────────

function CourseCard({
  course,
  onSave,
}: {
  course: CourseGradeResult;
  onSave: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { currentGrade, currentLetter, projectedFinal, projectedLetter } = course;
  const hasData = currentGrade != null;
  const barPct = projectedFinal ?? currentGrade ?? 0;
  const barColor = gradeBarColor(barPct);

  const neededForAMinus = course.neededForTarget["A-"];
  const neededForA = course.neededForTarget["A"];
  const swings = course.swingItems.filter((s) => s.canSwingLetter);

  return (
    <div
      className="card-elevated"
      style={{ padding: "0.9rem 1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
            {course.courseCode && (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontFamily: "var(--font-geist-mono)",
                  color: "var(--color-text-faint)",
                  background: "var(--color-surface-2)",
                  padding: "0.1rem 0.4rem",
                  borderRadius: "4px",
                }}
              >
                {course.courseCode}
              </span>
            )}
            <span
              style={{
                fontSize: "0.82rem",
                fontWeight: 600,
                color: "var(--color-text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {course.courseName}
            </span>
          </div>
          <div style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", marginTop: "0.15rem" }}>
            {(course.gradedWeightFraction * 100).toFixed(0)}% of grade entered
          </div>
        </div>

        {/* Grade badges */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.2rem", flexShrink: 0 }}>
          {hasData ? (
            <>
              <span
                style={{
                  fontSize: "1.4rem",
                  fontWeight: 700,
                  fontFamily: "var(--font-geist-mono)",
                  color: letterColor(currentLetter),
                  lineHeight: 1,
                }}
              >
                {currentLetter}
              </span>
              {projectedLetter && projectedLetter !== currentLetter && (
                <span style={{ fontSize: "0.65rem", color: "var(--color-text-faint)" }}>
                  proj. {projectedLetter}
                </span>
              )}
            </>
          ) : (
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-faint)" }}>No grades</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {hasData && (
        <div>
          <div
            style={{
              height: "4px",
              borderRadius: "2px",
              background: "var(--color-border)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min(100, barPct)}%`,
                background: barColor,
                borderRadius: "2px",
                transition: "width 0.6s ease",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.2rem" }}>
            <span style={{ fontSize: "0.6rem", color: "var(--color-text-faint)" }}>
              Current: {currentGrade?.toFixed(1)}%
            </span>
            {projectedFinal != null && (
              <span style={{ fontSize: "0.6rem", color: "var(--color-text-faint)" }}>
                Projected: {projectedFinal.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* What I need */}
      {hasData && course.gradedWeightFraction < 0.98 && (
        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--color-text-muted)",
            background: "var(--color-surface-2)",
            borderRadius: "6px",
            padding: "0.4rem 0.6rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.6rem",
          }}
        >
          {neededForA != null && (
            <span>
              <span style={{ color: "var(--color-text-faint)" }}>Need for A: </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  fontWeight: 600,
                  color: neededForA > 100 ? "#ef4444" : neededForA <= 0 ? "#22c55e" : "var(--color-text)",
                }}
              >
                {neededForA > 100 ? "N/A" : neededForA <= 0 ? "Done ✓" : `${neededForA.toFixed(1)}%`}
              </span>
            </span>
          )}
          {neededForAMinus != null && (
            <span>
              <span style={{ color: "var(--color-text-faint)" }}>A−: </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  fontWeight: 600,
                  color: neededForAMinus > 100 ? "#ef4444" : neededForAMinus <= 0 ? "#22c55e" : "var(--color-text)",
                }}
              >
                {neededForAMinus > 100 ? "N/A" : neededForAMinus <= 0 ? "Done ✓" : `${neededForAMinus.toFixed(1)}%`}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Swing warnings */}
      {swings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
          {swings.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.68rem",
                color: "#f59e0b",
                background: "rgba(245,158,11,0.08)",
                borderRadius: "4px",
                padding: "0.25rem 0.5rem",
              }}
            >
              <AlertTriangle size={10} style={{ flexShrink: 0 }} />
              <span>
                <strong>{s.title}</strong> ({(s.weight * 100).toFixed(0)}%) can move you{" "}
                <span style={{ color: letterColor(s.projectedIf0) }}>{s.projectedIf0}</span>
                {" → "}
                <span style={{ color: letterColor(s.projectedIf100) }}>{s.projectedIf100}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Expandable assignment list */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.3rem",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "0.68rem",
          color: "var(--color-text-faint)",
          padding: "0",
          alignSelf: "flex-start",
        }}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {expanded ? "Hide" : "Enter"} grades
      </button>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
          {course.components.map((comp) => (
            <ComponentSection key={comp.name} comp={comp} onSave={onSave} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Projected GPA bar ─────────────────────────────────────────────────────────

function ProjectedGPABar({ gpa, label }: { gpa: number; label: string }) {
  const color =
    gpa >= 3.7 ? "#22c55e" : gpa >= 3.0 ? "#f59e0b" : gpa >= 2.0 ? "#f97316" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <span style={{ fontSize: "0.68rem", color: "var(--color-text-faint)", width: "110px", flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ flex: 1, height: "4px", background: "var(--color-border)", borderRadius: "2px", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${(gpa / 4.0) * 100}%`,
            background: color,
            borderRadius: "2px",
            transition: "width 0.6s ease",
          }}
        />
      </div>
      <span
        style={{
          fontSize: "0.82rem",
          fontWeight: 700,
          fontFamily: "var(--font-geist-mono)",
          color,
          width: "36px",
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {gpa.toFixed(2)}
      </span>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function GradeIntelligencePanel() {
  const [data, setData] = useState<GradeIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/grade-intelligence");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="section-label">Grade Intelligence</span>
        {data && data.courses.length > 0 && (
          <span style={{ fontSize: "0.65rem", color: "var(--color-text-faint)" }}>
            {data.courses.length} course{data.courses.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {loading ? (
        <span style={{ fontSize: "0.8rem", color: "var(--color-text-faint)" }}>Loading…</span>
      ) : error ? (
        <span style={{ fontSize: "0.75rem", color: "#ef4444" }}>{error}</span>
      ) : !data || data.courses.length === 0 ? (
        <div style={{ textAlign: "center", padding: "1.5rem 0", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>No courses found</span>
          <span style={{ fontSize: "0.72rem", color: "var(--color-text-faint)" }}>
            Upload a syllabus via Brightspace panel to start tracking grades
          </span>
        </div>
      ) : (
        <>
          {/* Projected GPA summary */}
          {(data.projectedGPA != null || data.projectedGPAWithHistory != null) && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {data.projectedGPA != null && (
                <ProjectedGPABar gpa={data.projectedGPA} label="This semester" />
              )}
              {data.projectedGPAWithHistory != null && (
                <ProjectedGPABar gpa={data.projectedGPAWithHistory} label="Projected cumul." />
              )}
              <div className="divider" style={{ margin: "0.25rem 0" }} />
            </div>
          )}

          {/* Per-course cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {data.courses.map((course) => (
              <CourseCard key={course.courseId} course={course} onSave={load} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
