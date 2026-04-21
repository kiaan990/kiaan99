"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const SUGGESTIONS: Array<{ label: string; prompt: string }> = [
  {
    label: "Write",
    prompt:
      "Draft a short, persuasive note to a hiring manager explaining why I'd be a great fit for a design-engineer role.",
  },
  {
    label: "Code",
    prompt:
      "Write a TypeScript function that debounces an async function and cancels in-flight calls when a new one arrives.",
  },
  {
    label: "Explain",
    prompt:
      "Explain how HTTPS actually works, step by step, like I'm a curious high-school student.",
  },
  {
    label: "Plan",
    prompt:
      "Help me plan a 3-day weekend trip to Lisbon focused on food, architecture, and viewpoints.",
  },
];

function uid() {
  return Math.random().toString(36).slice(2, 11);
}

export default function AylinChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const autoSizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    autoSizeTextarea();
  }, [draft, autoSizeTextarea]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || streaming) return;

      setError(null);

      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: prompt,
      };
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "",
      };

      const nextHistory: ChatMessage[] = [...messages, userMsg];
      setMessages([...nextHistory, assistantMsg]);
      setDraft("");
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/aylin/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextHistory.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error ?? `Request failed (${res.status}).`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE frames separated by blank lines
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);

            let event = "message";
            let dataLine = "";
            for (const raw of frame.split("\n")) {
              if (raw.startsWith("event:")) event = raw.slice(6).trim();
              else if (raw.startsWith("data:")) dataLine += raw.slice(5).trim();
            }
            if (!dataLine) continue;
            let payload: unknown;
            try {
              payload = JSON.parse(dataLine);
            } catch {
              continue;
            }

            if (event === "delta") {
              const { text } = payload as { text: string };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: m.content + text }
                    : m,
                ),
              );
            } else if (event === "error") {
              const { message } = payload as { message: string };
              throw new Error(message);
            } else if (event === "done") {
              // no-op
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // user cancelled — keep partial content
        } else {
          const message =
            err instanceof Error ? err.message : "Something went wrong.";
          setError(message);
          setMessages((prev) =>
            prev.filter(
              (m) => !(m.id === assistantMsg.id && m.content === ""),
            ),
          );
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const empty = messages.length === 0;

  return (
    <div className="aylin">
      <header className="ay-header">
        <div className="ay-brand">
          <div className="ay-brand-mark">A</div>
          <span>Aylin Awsners</span>
          <span className="ay-brand-sub">AI · Refined</span>
        </div>
        <div className="ay-header-right">
          <span className="ay-pill">
            <span className="ay-dot" />
            Online
          </span>
        </div>
      </header>

      <main className="ay-main">
        <div className="ay-scroll" ref={scrollRef}>
          {error && <div className="ay-error">{error}</div>}

          {empty ? (
            <div className="ay-hero">
              <h1 className="ay-hero-title">Ask me anything.</h1>
              <p className="ay-hero-sub">
                I&apos;m Aylin Awsners — an AI assistant with the full
                capabilities of Claude. Writing, code, research, analysis, ideas
                — any of it.
              </p>
              <div className="ay-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    className="ay-suggestion"
                    onClick={() => send(s.prompt)}
                    disabled={streaming}
                  >
                    <span className="ay-suggestion-label">{s.label}</span>
                    {s.prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ay-messages">
              {messages.map((m, i) => {
                const isAssistant = m.role === "assistant";
                const isLast = i === messages.length - 1;
                const isLive = streaming && isLast && isAssistant;
                return (
                  <div className="ay-msg" key={m.id}>
                    <div className={`ay-msg-avatar ${m.role}`}>
                      {isAssistant ? "A" : "You"[0]}
                    </div>
                    <div className="ay-msg-body">
                      <div className="ay-msg-name">
                        {isAssistant ? "Aylin" : "You"}
                      </div>
                      <div className="ay-msg-content">
                        {m.content || (isLive ? null : "")}
                        {isLive && m.content.length === 0 && (
                          <div className="ay-typing">
                            <span />
                            <span />
                            <span />
                          </div>
                        )}
                        {isLive && m.content.length > 0 && (
                          <span className="ay-caret" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <form
          className="ay-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <div className="ay-composer-inner">
            <textarea
              ref={textareaRef}
              className="ay-textarea"
              placeholder="Message Aylin…"
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
              autoFocus
            />
            {streaming ? (
              <button
                type="button"
                className="ay-send"
                onClick={stop}
                aria-label="Stop"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                className="ay-send"
                disabled={!draft.trim()}
                aria-label="Send"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 14V3M3 8l5-5 5 5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
          <p className="ay-hint">
            Press Enter to send · Shift + Enter for a new line · Powered by
            Claude
          </p>
        </form>
      </main>
    </div>
  );
}
