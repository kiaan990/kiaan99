"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";

export default function Header() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const greeting = () => {
    const h = now.getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  return (
    <header
      style={{
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        padding: "0 2rem",
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      {/* Left — brand */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--color-gold)",
            boxShadow: "0 0 8px var(--color-gold)",
          }}
        />
        <span
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            color: "var(--color-text)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Command Center
        </span>
      </div>

      {/* Center — greeting */}
      <div
        style={{
          fontSize: "0.8rem",
          color: "var(--color-text-muted)",
          fontWeight: 400,
        }}
      >
        {greeting()}, {process.env.NEXT_PUBLIC_DASHBOARD_NAME ?? "there"}
      </div>

      {/* Right — date + time */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1.25rem",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--color-text-muted)",
          }}
        >
          {format(now, "EEEE, MMMM d")}
        </span>
        <span
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            color: "var(--color-gold)",
            fontFamily: "var(--font-geist-mono)",
            letterSpacing: "0.05em",
          }}
        >
          {format(now, "h:mm a")}
        </span>
      </div>
    </header>
  );
}
