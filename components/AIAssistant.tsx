"use client";

import { useEffect, useRef, useState } from "react";
import { Send, ImagePlus, X, Sparkles, Maximize2, Minimize2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  text: string;
  imagePreview?: string;
  panels?: string[];
}

interface HistoryEntry {
  role: "user" | "assistant";
  content: unknown;
}

const PANEL_LABELS: Record<string, string> = {
  todos: "To-Do",
  calendar: "Calendar",
  gpa: "GPA",
  goodnotes: "GoodNotes",
  brightspace: "Brightspace",
};

function ThinkingDots() {
  return (
    <div style={{ display: "flex", gap: "4px", padding: "2px 0" }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "var(--color-gold-dim)",
            animation: "pulse-dot 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes pulse-dot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

export default function AIAssistant({ onRefresh }: { onRefresh: (panels: string[]) => void }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hey, I'm JoeGPT — I control everything on this dashboard. Tell me what to do, or drop a screenshot and I'll handle it.",
    },
  ]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [input]);

  const handleImage = (file: File) => {
    setImage(file);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImage(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const send = async () => {
    if (!input.trim() && !image) return;
    setLoading(true);

    const userMsg: Message = { role: "user", text: input, imagePreview: imagePreview ?? undefined };
    setMessages((prev) => [...prev, userMsg]);
    const sentInput = input;
    setInput("");

    const fd = new FormData();
    if (sentInput.trim()) fd.append("message", sentInput.trim());
    if (image) fd.append("image", image);
    fd.append("history", JSON.stringify(history));
    clearImage();

    try {
      const res = await fetch("/api/ai-assistant", { method: "POST", body: fd });
      const data = await res.json();

      if (data.error === "unconfigured") {
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: "Add your ANTHROPIC_API_KEY to .env.local to enable me.",
        }]);
        setLoading(false);
        return;
      }

      const panels: string[] = data.refreshPanels ?? [];
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: data.reply || "Done.",
        panels: panels.length ? panels : undefined,
      }]);

      if (panels.length) onRefresh(panels);
      if (data.updatedHistory) setHistory(data.updatedHistory);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Something went wrong. Try again." }]);
    }

    setLoading(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (item) {
      const file = item.getAsFile();
      if (file) handleImage(file);
    }
  };

  const chatContent = (
    <>
      {/* Messages */}
      <div
        style={{
          flex: 1, overflowY: "auto", display: "flex", flexDirection: "column",
          gap: "0.75rem", minHeight: 0, padding: "0.25rem 0",
        }}
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: msg.role === "user" ? "row-reverse" : "row",
              alignItems: "flex-end",
              gap: "0.5rem",
            }}
          >
            {/* Avatar */}
            {msg.role === "assistant" && (
              <div
                style={{
                  width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                  background: "var(--color-gold-glow)",
                  border: "1px solid var(--color-gold-dim)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <Sparkles size={11} style={{ color: "var(--color-gold)" }} />
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", maxWidth: expanded ? "72%" : "86%", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
              {msg.imagePreview && (
                <img
                  src={msg.imagePreview}
                  alt="attached"
                  style={{
                    maxWidth: expanded ? "260px" : "160px",
                    borderRadius: "10px",
                    border: "1px solid var(--color-border)",
                  }}
                />
              )}

              {msg.text && (
                <div
                  style={{
                    padding: "0.6rem 0.875rem",
                    borderRadius: msg.role === "user" ? "14px 14px 3px 14px" : "3px 14px 14px 14px",
                    background: msg.role === "user"
                      ? "linear-gradient(135deg, var(--color-gold-glow), rgba(201,168,76,0.12))"
                      : "var(--color-surface-2)",
                    border: `1px solid ${msg.role === "user" ? "var(--color-gold-dim)" : "var(--color-border)"}`,
                    fontSize: expanded ? "0.875rem" : "0.8rem",
                    color: "var(--color-text)",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.text}
                </div>
              )}

              {msg.panels && msg.panels.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                  {msg.panels.map((p) => (
                    <span
                      key={p}
                      style={{
                        fontSize: "0.65rem", padding: "0.15rem 0.5rem",
                        borderRadius: "999px",
                        background: "rgba(201,168,76,0.08)",
                        border: "1px solid var(--color-gold-dim)",
                        color: "var(--color-gold-light)",
                      }}
                    >
                      ↻ {PANEL_LABELS[p] ?? p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: "0.5rem" }}>
            <div
              style={{
                width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                background: "var(--color-gold-glow)", border: "1px solid var(--color-gold-dim)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <Sparkles size={11} style={{ color: "var(--color-gold)" }} />
            </div>
            <div
              style={{
                padding: "0.6rem 0.875rem", borderRadius: "3px 14px 14px 14px",
                background: "var(--color-surface-2)", border: "1px solid var(--color-border)",
              }}
            >
              <ThinkingDots />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Image preview strip */}
      {imagePreview && (
        <div style={{ position: "relative", alignSelf: "flex-start", marginTop: "0.25rem" }}>
          <img
            src={imagePreview}
            alt="preview"
            style={{ height: "52px", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          />
          <button
            onClick={clearImage}
            style={{
              position: "absolute", top: -6, right: -6,
              background: "var(--color-surface)", border: "1px solid var(--color-border)",
              borderRadius: "50%", width: 18, height: 18,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}
          >
            <X size={10} />
          </button>
        </div>
      )}

      {/* Input bar */}
      <div
        style={{
          display: "flex", gap: "0.5rem", alignItems: "flex-end",
          background: "var(--color-surface-2)",
          border: "1px solid var(--color-border)",
          borderRadius: "14px",
          padding: "0.4rem 0.4rem 0.4rem 0.75rem",
        }}
      >
        <textarea
          ref={textareaRef}
          className="input"
          placeholder="Ask JoeGPT anything…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          style={{
            flex: 1, resize: "none", border: "none", background: "transparent",
            minHeight: "24px", maxHeight: "120px", overflowY: "auto",
            lineHeight: 1.5, padding: "0.2rem 0", fontSize: expanded ? "0.875rem" : "0.8rem",
            outline: "none", boxShadow: "none",
          }}
        />
        <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", flexShrink: 0 }}>
          <button
            className="btn-icon"
            onClick={() => fileRef.current?.click()}
            title="Attach image"
            style={{ padding: "0.3rem" }}
          >
            <ImagePlus size={15} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && handleImage(e.target.files[0])} />
          <button
            onClick={send}
            disabled={loading || (!input.trim() && !image)}
            style={{
              width: 32, height: 32, borderRadius: "10px", flexShrink: 0,
              background: loading || (!input.trim() && !image) ? "var(--color-surface)" : "var(--color-gold)",
              border: "none", cursor: loading || (!input.trim() && !image) ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s ease",
            }}
          >
            <Send size={13} style={{ color: loading || (!input.trim() && !image) ? "var(--color-text-faint)" : "#0d0d0d" }} />
          </button>
        </div>
      </div>
    </>
  );

  // ── Expanded modal overlay ────────────────────────────────────────
  if (expanded) {
    return (
      <>
        {/* Backdrop */}
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)", zIndex: 100,
          }}
        />
        {/* Panel */}
        <div
          style={{
            position: "fixed", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(720px, 90vw)", height: "min(680px, 85vh)",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "18px",
            boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
            zIndex: 101,
            display: "flex", flexDirection: "column", padding: "1.25rem",
            gap: "0.875rem",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: "8px", background: "var(--color-gold-glow)", border: "1px solid var(--color-gold-dim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Sparkles size={14} style={{ color: "var(--color-gold)" }} />
            </div>
            <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--color-text)", letterSpacing: "0.08em", textTransform: "uppercase" }}>JoeGPT</span>
            <span style={{ fontSize: "0.7rem", color: "var(--color-text-faint)", marginLeft: "0.25rem" }}>AI Assistant</span>
            <div style={{ flex: 1 }} />
            <button
              className="btn-icon"
              onClick={() => setExpanded(false)}
              title="Collapse"
            >
              <Minimize2 size={14} />
            </button>
          </div>
          <div style={{ height: "1px", background: "var(--color-border)" }} />
          {chatContent}
        </div>
      </>
    );
  }

  // ── Compact sidebar card ──────────────────────────────────────────
  return (
    <div
      className="card"
      style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem", height: "100%" }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <div style={{ width: 22, height: 22, borderRadius: "6px", background: "var(--color-gold-glow)", border: "1px solid var(--color-gold-dim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Sparkles size={11} style={{ color: "var(--color-gold)" }} />
        </div>
        <span className="section-label" style={{ flex: 1 }}>JoeGPT</span>
        <button
          className="btn-icon"
          onClick={() => setExpanded(true)}
          title="Expand"
        >
          <Maximize2 size={13} />
        </button>
      </div>

      {chatContent}
    </div>
  );
}
