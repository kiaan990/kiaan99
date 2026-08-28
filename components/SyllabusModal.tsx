"use client";

import { useCallback, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { X, Upload, AlertTriangle, CheckCircle, Trash2, Plus, Loader } from "lucide-react";
import type { ParsedSyllabus, ParsedItem, ParsedGradingComponent } from "@/lib/syllabus-parser";

// ─── Confidence indicator ────────────────────────────────────────────────────
function ConfidenceDot({ level }: { level: "high" | "medium" | "low" }) {
  const color = level === "high" ? "#27ae60" : level === "medium" ? "#e67e22" : "#e74c3c";
  const title = level === "high" ? "Date confirmed" : level === "medium" ? "Date inferred" : "Date uncertain — please verify";
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

// ─── Upload drop zone ────────────────────────────────────────────────────────
function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? "var(--color-gold)" : "var(--color-border)"}`,
        borderRadius: "14px",
        padding: "3rem 2rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.75rem",
        cursor: "pointer",
        background: dragging ? "rgba(200,146,42,0.04)" : "var(--color-surface-2)",
        transition: "all 0.15s ease",
      }}
    >
      <Upload size={28} style={{ color: dragging ? "var(--color-gold)" : "var(--color-text-faint)" }} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "0.9rem", fontWeight: 500, color: "var(--color-text)" }}>
          Drop your syllabus here
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
          PDF, DOCX, or TXT — click to browse
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
    </div>
  );
}

// ─── Parsing loading state ───────────────────────────────────────────────────
const PARSE_STEPS = [
  "Reading document…",
  "Extracting course information…",
  "Parsing grading breakdown…",
  "Resolving assignment dates…",
  "Extracting policies…",
  "Finalizing…",
];

function ParseLoader({ filename }: { filename: string }) {
  const [step, setStep] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const tick = useCallback(() => {
    setStep((s) => {
      const next = Math.min(s + 1, PARSE_STEPS.length - 1);
      if (next < PARSE_STEPS.length - 1) {
        timerRef.current = setTimeout(tick, 1800);
      }
      return next;
    });
  }, []);

  useState(() => {
    timerRef.current = setTimeout(tick, 1200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", padding: "3rem 2rem" }}>
      <div style={{ position: "relative", width: 48, height: 48 }}>
        <Loader size={48} style={{ color: "var(--color-gold)", animation: "spin 1.2s linear infinite" }} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "0.88rem", fontWeight: 500, color: "var(--color-text)" }}>{filename}</div>
        <div style={{ fontSize: "0.78rem", color: "var(--color-gold)", marginTop: "0.5rem", minHeight: "1.2em" }}>
          {PARSE_STEPS[step]}
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.35rem" }}>
        {PARSE_STEPS.map((_, i) => (
          <div
            key={i}
            style={{
              width: 6, height: 6, borderRadius: "50%",
              background: i <= step ? "var(--color-gold)" : "var(--color-border)",
              transition: "background 0.3s ease",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Review screen ───────────────────────────────────────────────────────────
function ReviewScreen({
  uploadId,
  initial,
  filename,
  onCommit,
  onDiscard,
}: {
  uploadId: string;
  initial: ParsedSyllabus;
  filename: string;
  onCommit: (courseId: string, itemCount: number) => void;
  onDiscard: () => void;
}) {
  const [data, setData] = useState<ParsedSyllabus>(initial);
  const [items, setItems] = useState<ParsedItem[]>(initial.items);
  const [grading, setGrading] = useState<ParsedGradingComponent[]>(initial.gradingComponents);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalWeight = grading.reduce((s, g) => s + g.weight, 0);
  const weightOk = Math.abs(totalWeight - 1) < 0.05;

  const updateCourse = (field: string, value: string) => {
    setData((d) => ({ ...d, course: { ...d.course, [field]: value || null } }));
  };

  const updateItem = (i: number, field: string, value: string | null) => {
    setItems((arr) => arr.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)));
  };

  const deleteItem = (i: number) => {
    setItems((arr) => arr.filter((_, idx) => idx !== i));
  };

  const updateGrading = (i: number, field: string, value: string) => {
    setGrading((arr) =>
      arr.map((g, idx) =>
        idx === i
          ? { ...g, [field]: field === "weight" ? Math.max(0, Math.min(1, parseFloat(value) / 100 || 0)) : value }
          : g
      )
    );
  };

  const deleteGrading = (i: number) => {
    setGrading((arr) => arr.filter((_, idx) => idx !== i));
  };

  const commit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/syllabus/${uploadId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, items, gradingComponents: grading }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Commit failed");
      onCommit(result.courseId, result.itemsCreated);
    } catch (err) {
      setError(String(err));
      setCommitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", overflow: "hidden", height: "100%" }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "0.25rem" }}>{filename}</div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <AlertTriangle size={15} style={{ color: "var(--color-warning)", flexShrink: 0 }} />
          <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
            Review everything before committing. Dates marked <span style={{ color: "#e74c3c" }}>●</span> are uncertain.
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {/* Course info */}
        <section>
          <div className="section-label" style={{ marginBottom: "0.6rem" }}>Course info</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div>
              <div style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", marginBottom: "0.2rem" }}>Course name *</div>
              <input className="input" value={data.course.name} onChange={(e) => updateCourse("name", e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", marginBottom: "0.2rem" }}>Course code</div>
              <input className="input" value={data.course.courseCode ?? ""} onChange={(e) => updateCourse("courseCode", e.target.value)} placeholder="e.g. MG 116" />
            </div>
            <div>
              <div style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", marginBottom: "0.2rem" }}>Professor</div>
              <input className="input" value={data.course.professor ?? ""} onChange={(e) => updateCourse("professor", e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", marginBottom: "0.2rem" }}>Professor email</div>
              <input className="input" value={data.course.professorEmail ?? ""} onChange={(e) => updateCourse("professorEmail", e.target.value)} />
            </div>
          </div>
          {data.course.officeHours && (
            <div style={{ marginTop: "0.5rem" }}>
              <div style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", marginBottom: "0.2rem" }}>Office hours</div>
              <input className="input" value={data.course.officeHours ?? ""} onChange={(e) => updateCourse("officeHours", e.target.value)} style={{ width: "100%" }} />
            </div>
          )}
          {data.course.meetingTimes.length > 0 && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              {data.course.meetingTimes.map((mt, i) => (
                <span key={i} style={{ marginRight: "1rem" }}>
                  {mt.dayOfWeek} {mt.startTime}–{mt.endTime}
                  {mt.location ? ` · ${mt.location}` : ""}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Grading breakdown */}
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.6rem" }}>
            <span className="section-label">Grading breakdown</span>
            {!weightOk && (
              <span style={{ fontSize: "0.65rem", color: "var(--color-error)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <AlertTriangle size={11} /> Weights sum to {Math.round(totalWeight * 100)}% (should be 100%)
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {grading.map((g, i) => (
              <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  className="input"
                  value={g.name}
                  onChange={(e) => updateGrading(i, "name", e.target.value)}
                  style={{ flex: 2 }}
                  placeholder="Component name"
                />
                <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", flex: "0 0 80px" }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(g.weight * 100)}
                    onChange={(e) => updateGrading(i, "weight", e.target.value)}
                    style={{ width: "60px", textAlign: "right" }}
                  />
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>%</span>
                </div>
                <button className="btn-icon" onClick={() => deleteGrading(i)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              className="btn-ghost"
              onClick={() => setGrading((g) => [...g, { name: "", weight: 0, description: null }])}
              style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.72rem", alignSelf: "flex-start" }}
            >
              <Plus size={11} /> Add component
            </button>
          </div>
        </section>

        {/* Policies */}
        {data.policies && data.policies.length > 0 && (
          <section>
            <div className="section-label" style={{ marginBottom: "0.6rem" }}>Policies extracted</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {data.policies.map((p, i) => (
                <div
                  key={i}
                  style={{
                    padding: "0.5rem 0.65rem",
                    background: "var(--color-surface-2)",
                    borderRadius: "8px",
                    borderLeft: "3px solid var(--color-border)",
                  }}
                >
                  <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-faint)", marginBottom: "0.2rem" }}>
                    {p.category.replace("_", " ")}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{p.content}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Items / schedule */}
        <section>
          <div className="section-label" style={{ marginBottom: "0.6rem" }}>
            {items.length} items extracted
          </div>
          {items.length === 0 ? (
            <div style={{ fontSize: "0.78rem", color: "var(--color-text-faint)" }}>No assignments or dates found</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {items.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    padding: "0.4rem 0.5rem",
                    borderRadius: "8px",
                    background: item.confidence === "low" ? "rgba(231,76,60,0.04)" : "var(--color-surface-2)",
                    border: `1px solid ${item.confidence === "low" ? "rgba(231,76,60,0.15)" : "transparent"}`,
                  }}
                >
                  <ConfidenceDot level={item.confidence ?? "medium"} />

                  <input
                    className="input"
                    value={item.title}
                    onChange={(e) => updateItem(i, "title", e.target.value)}
                    style={{ flex: 2, fontSize: "0.78rem" }}
                  />

                  <select
                    className="input"
                    value={item.type}
                    onChange={(e) => updateItem(i, "type", e.target.value)}
                    style={{ flex: "0 0 90px", fontSize: "0.72rem" }}
                  >
                    {["assignment", "reading", "quiz", "exam", "project", "other"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>

                  <div style={{ flex: "0 0 130px" }}>
                    <input
                      type="date"
                      className="input"
                      value={item.dueDate ?? ""}
                      onChange={(e) => updateItem(i, "dueDate", e.target.value || null)}
                      style={{ fontSize: "0.72rem" }}
                    />
                    {item.dueDateRaw && !item.dueDate && (
                      <div style={{ fontSize: "0.6rem", color: "var(--color-error)", marginTop: "0.15rem" }}>
                        "{item.dueDateRaw}"
                      </div>
                    )}
                  </div>

                  <button className="btn-icon" onClick={() => deleteItem(i)} style={{ flexShrink: 0 }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Footer actions */}
      {error && (
        <div style={{ fontSize: "0.75rem", color: "var(--color-error)", padding: "0.5rem 0.65rem", background: "rgba(231,76,60,0.07)", borderRadius: "8px" }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", flexShrink: 0 }}>
        <button className="btn-ghost" onClick={onDiscard} disabled={committing}>
          Discard
        </button>
        <button
          className="btn-gold"
          onClick={commit}
          disabled={committing || !data.course.name.trim()}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          {committing ? (
            <><Loader size={13} style={{ animation: "spin 1.2s linear infinite" }} /> Committing…</>
          ) : (
            <>Commit to dashboard</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Success screen ──────────────────────────────────────────────────────────
function DoneScreen({ courseName, itemCount, onClose }: { courseName: string; itemCount: number; onClose: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "3rem 2rem", textAlign: "center" }}>
      <CheckCircle size={40} style={{ color: "#27ae60" }} />
      <div>
        <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-text)" }}>{courseName}</div>
        <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "0.35rem" }}>
          {itemCount} assignment{itemCount !== 1 ? "s" : ""} added to your dashboard
        </div>
      </div>
      <button className="btn-gold" onClick={onClose}>Done</button>
    </div>
  );
}

// ─── Main modal ──────────────────────────────────────────────────────────────
export default function SyllabusModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [state, setState] = useState<"upload" | "parsing" | "reviewing" | "done">("upload");
  const [filename, setFilename] = useState("");
  const [uploadId, setUploadId] = useState("");
  const [parsed, setParsed] = useState<ParsedSyllabus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneInfo, setDoneInfo] = useState<{ name: string; count: number } | null>(null);

  const handleFile = async (file: File) => {
    setFilename(file.name);
    setError(null);
    setState("parsing");

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/syllabus", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setUploadId(data.uploadId);
      setParsed(data.parsed);
      setState("reviewing");
    } catch (err) {
      setError(String(err));
      setState("upload");
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget && state !== "parsing") onClose(); }}
    >
      <div
        className="animate-fade-in"
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "18px",
          width: "min(800px, 95vw)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Modal header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1rem 1.25rem",
            borderBottom: "1px solid var(--color-border-subtle)",
            flexShrink: 0,
          }}
        >
          <span className="section-label">Import Syllabus</span>
          {state !== "parsing" && (
            <button className="btn-icon" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Modal body */}
        <div style={{ flex: 1, overflow: "hidden", padding: "1.25rem", display: "flex", flexDirection: "column" }}>
          {state === "upload" && (
            <>
              <DropZone onFile={handleFile} />
              {error && (
                <div style={{ marginTop: "1rem", fontSize: "0.78rem", color: "var(--color-error)", padding: "0.6rem 0.75rem", background: "rgba(231,76,60,0.07)", borderRadius: "8px" }}>
                  <strong>Error:</strong> {error}
                </div>
              )}
              <div style={{ marginTop: "1rem", fontSize: "0.72rem", color: "var(--color-text-faint)", textAlign: "center" }}>
                Requires an active semester in settings for accurate date resolution.
                {!process.env.ANTHROPIC_API_KEY && " Add ANTHROPIC_API_KEY to .env.local."}
              </div>
            </>
          )}

          {state === "parsing" && <ParseLoader filename={filename} />}

          {state === "reviewing" && parsed && (
            <ReviewScreen
              uploadId={uploadId}
              initial={parsed}
              filename={filename}
              onCommit={(courseId, itemCount) => {
                setDoneInfo({ name: parsed.course.name, count: itemCount });
                setState("done");
                onImported();
              }}
              onDiscard={() => setState("upload")}
            />
          )}

          {state === "done" && doneInfo && (
            <DoneScreen
              courseName={doneInfo.name}
              itemCount={doneInfo.count}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
