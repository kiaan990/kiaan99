"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  format,
  isToday,
  isTomorrow,
  startOfWeek,
  addDays,
  isSameDay,
  parseISO,
} from "date-fns";
import { Plus, RefreshCw, ChevronRight, ChevronDown, Upload, Trash2 } from "lucide-react";

interface ImportedCalendar {
  id: string;
  name: string;
  color: string;
  fileName: string;
}

function ICSDropZone({ onImported }: { onImported: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<ImportedCalendar[]>([]);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadCalendars = useCallback(async () => {
    const res = await fetch("/api/calendar/import");
    const data = await res.json();
    setCalendars(data.calendars ?? []);
  }, []);

  useEffect(() => { loadCalendars(); }, [loadCalendars]);

  const uploadFiles = async (files: FileList | File[]) => {
    const icsFiles = Array.from(files).filter((f) => f.name.endsWith(".ics"));
    if (!icsFiles.length) {
      setMessage("No .ics files found");
      setTimeout(() => setMessage(null), 3000);
      return;
    }
    setImporting(true);
    const fd = new FormData();
    icsFiles.forEach((f) => fd.append("files", f));
    const res = await fetch("/api/calendar/import", { method: "POST", body: fd });
    const data = await res.json();
    setImporting(false);
    if (data.imported) {
      const total = data.imported.reduce((s: number, c: { count: number }) => s + c.count, 0);
      setMessage(`Imported ${total} events from ${data.imported.length} calendar(s)`);
      setTimeout(() => setMessage(null), 4000);
      loadCalendars();
      onImported();
    }
  };

  const deleteCalendar = async (id: string) => {
    await fetch(`/api/calendar/import?id=${id}`, { method: "DELETE" });
    loadCalendars();
    onImported();
  };

  return (
    <div style={{ marginBottom: "0.75rem" }}>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `1.5px dashed ${dragging ? "var(--color-gold)" : "var(--color-border)"}`,
          borderRadius: "8px",
          padding: "0.6rem 0.75rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          cursor: "pointer",
          background: dragging ? "var(--color-gold-glow)" : "transparent",
          transition: "all 0.15s ease",
        }}
      >
        <Upload size={13} style={{ color: "var(--color-text-faint)", flexShrink: 0 }} />
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          {importing ? "Importing…" : message ?? "Drop .ics files here or click to browse"}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".ics"
          multiple
          style={{ display: "none" }}
          onChange={(e) => e.target.files && uploadFiles(e.target.files)}
        />
      </div>

      {/* Imported calendars list — collapsible */}
      {calendars.length > 0 && (
        <div style={{ marginTop: "0.4rem" }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.1rem 0",
              color: "var(--color-text-faint)",
            }}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <span style={{ fontSize: "0.68rem" }}>
              {calendars.length} calendar{calendars.length !== 1 ? "s" : ""}
            </span>
            {/* color dots preview when collapsed */}
            {!expanded && (
              <span style={{ display: "flex", gap: "0.2rem", marginLeft: "0.2rem" }}>
                {calendars.slice(0, 6).map((cal) => (
                  <span key={cal.id} style={{ width: 6, height: 6, borderRadius: "50%", background: cal.color }} />
                ))}
                {calendars.length > 6 && (
                  <span style={{ fontSize: "0.6rem", color: "var(--color-text-faint)" }}>+{calendars.length - 6}</span>
                )}
              </span>
            )}
          </button>

          {expanded && (
            <div style={{ marginTop: "0.25rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
              {calendars.map((cal) => (
                <div key={cal.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.15rem 0.25rem" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: cal.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: "0.72rem", color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cal.name}
                  </span>
                  <button
                    className="btn-icon"
                    onClick={() => deleteCalendar(cal.id)}
                    title="Remove calendar"
                    style={{ padding: "0.15rem" }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  calendarName: string;
  calendarColor: string;
}

interface EventGroup {
  label: string;
  date: Date;
  events: CalEvent[];
}

function AddEventModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!title || !start || !end) {
      setError("Title, start, and end are required.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, start, end, allDay, notes, location }),
    });
    setLoading(false);
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Failed to create event");
      return;
    }
    onAdded();
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="card animate-fade-in"
        style={{ padding: "1.5rem", width: "100%", maxWidth: "420px" }}
      >
        <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem", color: "var(--color-text)" }}>
          New Event
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <input className="input" placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} />

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", color: "var(--color-text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            All-day event
          </label>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type={allDay ? "date" : "datetime-local"}
              className="input"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              type={allDay ? "date" : "datetime-local"}
              className="input"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>

          <input className="input" placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
          <input className="input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

          {error && <p style={{ fontSize: "0.75rem", color: "var(--color-error)" }}>{error}</p>}

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn-gold" onClick={submit} disabled={loading}>
              {loading ? "Creating…" : "Create Event"}
            </button>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WeekStrip({
  events,
  selected,
  onSelect,
}: {
  events: CalEvent[];
  selected: Date;
  onSelect: (d: Date) => void;
}) {
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: "0.25rem",
        marginBottom: "0.75rem",
      }}
    >
      {days.map((day) => {
        const hasEvents = events.some((e) => isSameDay(parseISO(e.start), day));
        const isSelected = isSameDay(day, selected);
        const today = isToday(day);

        return (
          <button
            key={day.toISOString()}
            onClick={() => onSelect(day)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.2rem",
              padding: "0.4rem 0",
              borderRadius: "8px",
              border: "1px solid",
              cursor: "pointer",
              background: isSelected
                ? "var(--color-gold-glow)"
                : today
                ? "var(--color-surface-2)"
                : "transparent",
              borderColor: isSelected
                ? "var(--color-gold-dim)"
                : today
                ? "var(--color-border)"
                : "transparent",
              transition: "all 0.15s ease",
            }}
          >
            <span
              style={{
                fontSize: "0.6rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: isSelected ? "var(--color-gold-light)" : "var(--color-text-muted)",
              }}
            >
              {format(day, "EEE")}
            </span>
            <span
              style={{
                fontSize: "0.85rem",
                fontWeight: today ? 700 : 400,
                color: isSelected
                  ? "var(--color-gold-light)"
                  : today
                  ? "var(--color-text)"
                  : "var(--color-text-muted)",
              }}
            >
              {format(day, "d")}
            </span>
            {hasEvents && (
              <div
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: isSelected ? "var(--color-gold)" : "var(--color-gold-dim)",
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function EventCard({ event }: { event: CalEvent }) {
  const start = parseISO(event.start);
  const end = parseISO(event.end);

  return (
    <div
      className="animate-fade-in"
      style={{
        display: "flex",
        gap: "0.75rem",
        padding: "0.6rem 0.75rem",
        borderRadius: "8px",
        background: "var(--color-surface-2)",
        borderLeft: `3px solid ${event.calendarColor || "var(--color-gold)"}`,
        marginBottom: "0.4rem",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "0.85rem",
            fontWeight: 500,
            color: "var(--color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {event.title}
        </div>
        <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginTop: "0.15rem" }}>
          {event.allDay ? "All day" : `${format(start, "h:mm a")} – ${format(end, "h:mm a")}`}
          {event.location && ` · ${event.location}`}
        </div>
      </div>
      <div
        style={{
          fontSize: "0.65rem",
          color: "var(--color-text-faint)",
          alignSelf: "flex-start",
          flexShrink: 0,
        }}
      >
        {event.calendarName}
      </div>
    </div>
  );
}

export default function CalendarPanel() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [upcomingExpanded, setUpcomingExpanded] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    const res = await fetch("/api/calendar");
    const data = await res.json();
    setRefreshing(false);
    setLoading(false);
    setEvents(data.events ?? []);
  };

  useEffect(() => { load(); }, []);

  // Group events by day relative to selected
  const dayEvents = events.filter((e) =>
    isSameDay(parseISO(e.start), selectedDay)
  );

  const upcoming = events
    .filter((e) => {
      const d = parseISO(e.start);
      return d >= new Date() && !isSameDay(d, selectedDay);
    })
    .slice(0, 5);

  const todayLabel = isToday(selectedDay)
    ? "Today"
    : isTomorrow(selectedDay)
    ? "Tomorrow"
    : format(selectedDay, "EEEE, MMM d");

  return (
    <>
      {showAdd && (
        <AddEventModal
          onClose={() => setShowAdd(false)}
          onAdded={() => { load(); setShowAdd(false); }}
        />
      )}

      <div
        className="card"
        style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem", height: "100%" }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="section-label">Calendar</span>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <button
              className="btn-icon"
              onClick={load}
              disabled={refreshing}
              title="Refresh"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            </button>
            <button className="btn-gold" onClick={() => setShowAdd(true)}>
              <Plus size={13} style={{ display: "inline", marginRight: "0.3rem" }} />
              Event
            </button>
          </div>
        </div>

        <ICSDropZone onImported={load} />

        <WeekStrip events={events} selected={selectedDay} onSelect={setSelectedDay} />

        <div>
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: isToday(selectedDay) ? "var(--color-gold-light)" : "var(--color-text-muted)",
              marginBottom: "0.5rem",
            }}
          >
            {todayLabel}
          </div>

          {loading ? (
            <div style={{ fontSize: "0.8rem", color: "var(--color-text-faint)" }}>Loading…</div>
          ) : dayEvents.length === 0 ? (
            <div
              style={{
                fontSize: "0.8rem",
                color: "var(--color-text-faint)",
                padding: "0.75rem",
                textAlign: "center",
                borderRadius: "8px",
                border: "1px dashed var(--color-border)",
              }}
            >
              No events
            </div>
          ) : (
            <div className="stagger">
              {dayEvents.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          )}
        </div>

        {upcoming.length > 0 && (
          <div>
            <div className="divider" />
            <button
              onClick={() => setUpcomingExpanded((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0 0 0.5rem 0",
                width: "100%",
              }}
            >
              <span className="section-label" style={{ flex: 1, textAlign: "left" }}>Upcoming</span>
              {upcomingExpanded
                ? <ChevronDown size={11} style={{ color: "var(--color-text-faint)" }} />
                : <ChevronRight size={11} style={{ color: "var(--color-text-faint)" }} />}
            </button>
            {upcomingExpanded && <div className="stagger">
              {upcoming.map((e) => (
                <div
                  key={e.id}
                  className="animate-fade-in"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.4rem 0",
                    borderBottom: "1px solid var(--color-border-subtle)",
                    cursor: "pointer",
                  }}
                  onClick={() => setSelectedDay(parseISO(e.start))}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: e.calendarColor || "var(--color-gold)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, fontSize: "0.8rem", color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.title}
                  </span>
                  <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", flexShrink: 0 }}>
                    {isToday(parseISO(e.start))
                      ? "Today"
                      : isTomorrow(parseISO(e.start))
                      ? "Tmrw"
                      : format(parseISO(e.start), "MMM d")}
                  </span>
                  <ChevronRight size={11} style={{ color: "var(--color-text-faint)", flexShrink: 0 }} />
                </div>
              ))}
            </div>}
          </div>
        )}
      </div>
    </>
  );
}
