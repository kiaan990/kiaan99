"use client";

import { useEffect, useState, useRef } from "react";
import { format, isPast, isToday } from "date-fns";
import { Plus, X, ChevronDown, Tag, Calendar, Flag } from "lucide-react";

interface Todo {
  id: string;
  title: string;
  description?: string;
  priority: "high" | "medium" | "low";
  dueDate?: string | null;
  tags: string[];
  completed: boolean;
  createdAt: string;
}

const PRIORITY_CONFIG = {
  high: { label: "High", color: "#c0392b", dot: "#e74c3c" },
  medium: { label: "Med", color: "#d68910", dot: "#f39c12" },
  low: { label: "Low", color: "#4a4a45", dot: "#888880" },
};

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function AddTodoForm({ onAdd }: { onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [dueDate, setDueDate] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput("");
  };

  const submit = async () => {
    if (!title.trim()) return;
    setLoading(true);
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), priority, dueDate: dueDate || null, tags }),
    });
    setTitle("");
    setPriority("medium");
    setDueDate("");
    setTags([]);
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
        <Plus size={14} />
        Add task
      </button>
    );
  }

  return (
    <div className="card-elevated animate-fade-in" style={{ padding: "0.875rem", marginBottom: "0.5rem" }}>
      <input
        ref={inputRef}
        className="input"
        placeholder="Task title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        style={{ marginBottom: "0.6rem" }}
      />

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.6rem" }}>
        <select
          className="input"
          value={priority}
          onChange={(e) => setPriority(e.target.value as "high" | "medium" | "low")}
          style={{ flex: 1 }}
        >
          <option value="high">High priority</option>
          <option value="medium">Medium priority</option>
          <option value="low">Low priority</option>
        </select>

        <input
          type="date"
          className="input"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.6rem", alignItems: "center" }}>
        <input
          className="input"
          placeholder="Add tag..."
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
          style={{ flex: 1 }}
        />
        <button className="btn-ghost" onClick={addTag}>+</button>
      </div>

      {tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginBottom: "0.6rem" }}>
          {tags.map((t) => (
            <span key={t} className="badge badge-surface" style={{ gap: "0.3rem", cursor: "pointer" }} onClick={() => setTags((prev) => prev.filter((x) => x !== t))}>
              {t} ×
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="btn-gold" onClick={submit} disabled={loading || !title.trim()}>
          {loading ? "Adding…" : "Add Task"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function TodoItem({ todo, onUpdate }: { todo: Todo; onUpdate: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const pc = PRIORITY_CONFIG[todo.priority];

  const toggleComplete = async () => {
    await fetch(`/api/todos?id=${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: !todo.completed }),
    });
    onUpdate();
  };

  const deleteTodo = async () => {
    setDeleting(true);
    await fetch(`/api/todos?id=${todo.id}`, { method: "DELETE" });
    onUpdate();
  };

  const isDue = todo.dueDate && isToday(new Date(todo.dueDate));
  const isOverdue = todo.dueDate && isPast(new Date(todo.dueDate)) && !isToday(new Date(todo.dueDate));

  return (
    <div
      className="animate-fade-in"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.6rem",
        padding: "0.6rem 0.5rem",
        borderRadius: "8px",
        borderBottom: "1px solid var(--color-border-subtle)",
        opacity: todo.completed ? 0.45 : 1,
        transition: "opacity 0.2s ease",
      }}
    >
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={toggleComplete}
        className="checkbox"
        style={{ marginTop: "2px" }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span
            className="status-dot"
            style={{ background: pc.dot }}
          />
          <span
            style={{
              fontSize: "0.85rem",
              color: "var(--color-text)",
              textDecoration: todo.completed ? "line-through" : "none",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {todo.title}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.25rem", flexWrap: "wrap" }}>
          {todo.dueDate && (
            <span
              className="badge"
              style={{
                background: isOverdue ? "rgba(192,57,43,0.1)" : isDue ? "rgba(214,137,16,0.1)" : "transparent",
                color: isOverdue ? "#e74c3c" : isDue ? "#f39c12" : "var(--color-text-faint)",
                border: "none",
                padding: "0",
                fontSize: "0.7rem",
              }}
            >
              {format(new Date(todo.dueDate), "MMM d")}
            </span>
          )}
          {todo.tags.map((tag) => (
            <span key={tag} className="badge badge-surface" style={{ fontSize: "0.65rem" }}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      <button
        className="btn-icon"
        onClick={deleteTodo}
        disabled={deleting}
        style={{ flexShrink: 0 }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

export default function TodoPanel() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "done">("active");

  const load = async () => {
    const res = await fetch("/api/todos");
    const data = await res.json();
    setTodos(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const visible = todos
    .filter((t) =>
      filter === "all" ? true : filter === "active" ? !t.completed : t.completed
    )
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  const activeCount = todos.filter((t) => !t.completed).length;
  const overdueCount = todos.filter(
    (t) => !t.completed && t.dueDate && isPast(new Date(t.dueDate)) && !isToday(new Date(t.dueDate))
  ).length;

  return (
    <div className="card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem", height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span className="section-label">To-Do</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.2rem" }}>
            <span style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--color-text)" }}>
              {activeCount}
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>tasks left</span>
            {overdueCount > 0 && (
              <span className="badge badge-error">{overdueCount} overdue</span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.25rem" }}>
          {(["active", "all", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "0.25rem 0.6rem",
                borderRadius: "5px",
                fontSize: "0.7rem",
                fontWeight: 500,
                border: "1px solid",
                cursor: "pointer",
                background: filter === f ? "var(--color-gold-glow)" : "transparent",
                borderColor: filter === f ? "var(--color-gold-dim)" : "var(--color-border)",
                color: filter === f ? "var(--color-gold-light)" : "var(--color-text-muted)",
                transition: "all 0.15s ease",
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Add form */}
      <AddTodoForm onAdd={load} />

      {/* List */}
      <div
        className="stagger"
        style={{
          flex: 1,
          overflowY: "auto",
          marginTop: "-0.25rem",
        }}
      >
        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-faint)", fontSize: "0.8rem" }}>
            Loading…
          </div>
        ) : visible.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-faint)", fontSize: "0.8rem" }}>
            {filter === "done" ? "No completed tasks" : "All clear."}
          </div>
        ) : (
          visible.map((todo) => (
            <TodoItem key={todo.id} todo={todo} onUpdate={load} />
          ))
        )}
      </div>
    </div>
  );
}
