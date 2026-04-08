import Header from "@/components/Header";
import CalendarPanel from "@/components/CalendarPanel";
import TodoPanel from "@/components/TodoPanel";
import GPAPanel from "@/components/GPAPanel";
import EmailPanel from "@/components/EmailPanel";
import BrightspacePanel from "@/components/BrightspacePanel";
import GoodNotesPanel from "@/components/GoodNotesPanel";

export default function DashboardPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-base)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Header />

      <main
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "300px 1fr 320px",
          gridTemplateRows: "auto",
          gap: "1rem",
          padding: "1rem 1.25rem 1.25rem",
          maxWidth: "1600px",
          margin: "0 auto",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {/* ─── LEFT COLUMN ─── */}
        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            minWidth: 0,
          }}
        >
          {/* Outlook + Gmail */}
          <EmailPanel />

          {/* GoodNotes Quick Launch */}
          <GoodNotesPanel />
        </aside>

        {/* ─── CENTER COLUMN ─── */}
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            minWidth: 0,
          }}
        >
          {/* Calendar */}
          <div style={{ flex: "0 0 auto" }}>
            <CalendarPanel />
          </div>

          {/* Brightspace */}
          <div style={{ flex: 1 }}>
            <BrightspacePanel />
          </div>
        </section>

        {/* ─── RIGHT COLUMN ─── */}
        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            minWidth: 0,
          }}
        >
          {/* To-Do */}
          <div style={{ flex: "0 1 auto", minHeight: 0 }}>
            <TodoPanel />
          </div>

          {/* GPA Tracker */}
          <div style={{ flex: "0 0 auto" }}>
            <GPAPanel />
          </div>
        </aside>
      </main>
    </div>
  );
}
