import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Command Center",
  description: "Personal dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full`}
    >
      <body className="min-h-full">
        {/* Deep Space background orbs */}
        <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
          <div style={{ position: "absolute", width: 600, height: 600, borderRadius: "50%", background: "rgba(99,91,255,0.1)", filter: "blur(100px)", top: -150, left: -100, animation: "orbDrift 14s ease-in-out infinite alternate" }} />
          <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "rgba(56,189,248,0.07)", filter: "blur(90px)", bottom: -100, right: 50, animation: "orbDrift 14s ease-in-out infinite alternate", animationDelay: "-5s" }} />
          <div style={{ position: "absolute", width: 350, height: 350, borderRadius: "50%", background: "rgba(168,85,247,0.07)", filter: "blur(80px)", top: "40%", left: "45%", animation: "orbDrift 14s ease-in-out infinite alternate", animationDelay: "-9s" }} />
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      </body>
    </html>
  );
}
