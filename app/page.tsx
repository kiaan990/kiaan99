import Header from "@/components/Header";
import DailyBriefPanel from "@/components/DailyBriefPanel";
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

      {/* ─── Daily Brief — full width strip ─── */}
      <div style={{ padding: "1rem 0 0" }}>
        <DailyBriefPanel />
      </div>

      {/* ─── Main grid ─── */}
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
          <EmailPanel />
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
          <div style={{ flex: "0 0 auto" }}>
            <CalendarPanel />
          </div>
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
          <div style={{ flex: "0 1 auto", minHeight: 0 }}>
            <TodoPanel />
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <GPAPanel />
          </div>
        </aside>
      </main>
    </div>
  );
}
