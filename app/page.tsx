"use client";

import { useState } from "react";
import Header from "@/components/Header";
import CalendarPanel from "@/components/CalendarPanel";
import TodoPanel from "@/components/TodoPanel";
import GPAPanel from "@/components/GPAPanel";
import EmailPanel from "@/components/EmailPanel";
import BrightspacePanel from "@/components/BrightspacePanel";
import GoodNotesPanel from "@/components/GoodNotesPanel";
import AIAssistant from "@/components/AIAssistant";

export default function DashboardPage() {
  const [keys, setKeys] = useState({ todos: 0, calendar: 0, gpa: 0, goodnotes: 0, brightspace: 0 });

  const refresh = (panels: string[]) => {
    setKeys((prev) => {
      const next = { ...prev };
      for (const p of panels) {
        if (p in next) next[p as keyof typeof next]++;
      }
      return next;
    });
  };

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
        <aside style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>
          <EmailPanel />
          <GoodNotesPanel key={keys.goodnotes} />
        </aside>

        {/* ─── CENTER COLUMN ─── */}
        <section style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>
          <div style={{ flex: "0 0 auto" }}>
            <CalendarPanel key={keys.calendar} />
          </div>
          <div style={{ flex: 1 }}>
            <BrightspacePanel key={keys.brightspace} />
          </div>
        </section>

        {/* ─── RIGHT COLUMN ─── */}
        <aside style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>
          <div style={{ flex: "0 1 auto", minHeight: 0 }}>
            <TodoPanel key={keys.todos} />
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <GPAPanel key={keys.gpa} />
          </div>
          <div style={{ flex: "1 1 280px", minHeight: "280px" }}>
            <AIAssistant onRefresh={refresh} />
          </div>
        </aside>
      </main>
    </div>
  );
}
