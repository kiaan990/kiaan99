"use client";

import { useEffect, useState } from "react";
import { Plus, ExternalLink, Trash2, GripVertical } from "lucide-react";

interface GoodNotesLink {
  id: string;
  name: string;
  description?: string;
  url: string;
  emoji: string;
  sortOrder: number;
}

function AddLinkForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [emoji, setEmoji] = useState("📓");
  const [loading, setLoading] = useState(false);

  const QUICK_EMOJIS = ["📓", "📚", "📝", "🖊️", "📖", "🗒️", "📋", "🎓", "💡", "🧠"];

  const submit = async () => {
    if (!name.trim() || !url.trim()) return;
    setLoading(true);
    await fetch("/api/goodnotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, url: url.trim(), emoji }),
    });
    setName(""); setDescription(""); setUrl(""); setEmoji("📓");
    setOpen(false); setLoading(false);
    onAdded();
  };

  if (!open) {
    return (
      <button
        className="btn-ghost"
        onClick={() => setOpen(true)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "center" }}
      >
        <Plus size={13} /> Add notebook link
      </button>
    );
  }

  return (
    <div className="card-elevated animate-fade-in" style={{ padding: "0.875rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input className="input" placeholder="Notebook name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
      </div>

      {/* Emoji picker */}
      <div>
        <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginBottom: "0.3rem" }}>Icon</div>
        <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              style={{
                fontSize: "1rem",
                padding: "0.2rem 0.35rem",
                borderRadius: "5px",
                border: "1px solid",
                cursor: "pointer",
                background: emoji === e ? "var(--color-gold-glow)" : "transparent",
                borderColor: emoji === e ? "var(--color-gold-dim)" : "var(--color-border)",
                transition: "all 0.1s ease",
              }}
            >
              {e}
            </button>
          ))}
          <input
            className="input"
            placeholder="or custom"
            value={QUICK_EMOJIS.includes(emoji) ? "" : emoji}
            onChange={(e) => setEmoji(e.target.value || "📓")}
            style={{ width: "80px", flex: "none" }}
            maxLength={2}
          />
        </div>
      </div>

      <input className="input" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />

      <div>
        <input
          className="input"
          placeholder="URL or goodnotes5://... deep link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", marginTop: "0.3rem" }}>
          Use <code style={{ fontFamily: "var(--font-geist-mono)" }}>goodnotes5://</code> deep links to open specific notebooks, or any HTTPS URL.
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="btn-gold" onClick={submit} disabled={loading || !name.trim() || !url.trim()}>
          {loading ? "Adding…" : "Add"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function LinkCard({ link, onDelete }: { link: GoodNotesLink; onDelete: () => void }) {
  const [hovering, setHovering] = useState(false);

  const openLink = () => {
    window.open(link.url, "_blank", "noopener,noreferrer");
  };

  const deleteLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/goodnotes?id=${link.id}`, { method: "DELETE" });
    onDelete();
  };

  return (
    <div
      className="animate-fade-in"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.6rem 0.75rem",
        borderRadius: "9px",
        background: hovering ? "var(--color-surface-2)" : "transparent",
        border: "1px solid",
        borderColor: hovering ? "var(--color-border)" : "transparent",
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
      onClick={openLink}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "9px",
          background: "var(--color-surface-2)",
          border: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.1rem",
          flexShrink: 0,
          transition: "border-color 0.15s ease",
          borderColor: hovering ? "var(--color-gold-dim)" : "var(--color-border)",
        }}
      >
        {link.emoji}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "0.82rem",
            fontWeight: 500,
            color: "var(--color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {link.name}
        </div>
        {link.description && (
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
            {link.description}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.25rem", opacity: hovering ? 1 : 0, transition: "opacity 0.15s ease" }}>
        <button className="btn-icon" onClick={deleteLink}>
          <Trash2 size={12} />
        </button>
        <ExternalLink size={12} style={{ color: "var(--color-text-faint)" }} />
      </div>
    </div>
  );
}

export default function GoodNotesPanel() {
  const [links, setLinks] = useState<GoodNotesLink[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const res = await fetch("/api/goodnotes");
    const data = await res.json();
    setLinks(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span className="section-label">GoodNotes</span>
          <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginTop: "0.15rem" }}>
            Quick Launch
          </div>
        </div>
        <span style={{ fontSize: "1rem" }}>📓</span>
      </div>

      {loading ? (
        <div style={{ fontSize: "0.8rem", color: "var(--color-text-faint)" }}>Loading…</div>
      ) : links.length === 0 ? (
        <div
          style={{
            padding: "1.25rem",
            textAlign: "center",
            color: "var(--color-text-faint)",
            fontSize: "0.78rem",
            border: "1px dashed var(--color-border)",
            borderRadius: "8px",
            lineHeight: 1.8,
          }}
        >
          No notebook links yet.
          <br />
          Add shortcuts to your GoodNotes notebooks below.
          <br />
          <span style={{ fontSize: "0.7rem", color: "var(--color-text-faint)" }}>
            Tip: Use the GoodNotes Share button → Copy Link to get a deep link.
          </span>
        </div>
      ) : (
        <div className="stagger" style={{ display: "flex", flexDirection: "column" }}>
          {links.map((link) => (
            <LinkCard key={link.id} link={link} onDelete={load} />
          ))}
        </div>
      )}

      <div className="divider" style={{ margin: 0 }} />
      <AddLinkForm onAdded={load} />
    </div>
  );
}
