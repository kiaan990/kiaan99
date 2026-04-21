import type { Metadata, Viewport } from "next";
import "./aylin.css";

export const metadata: Metadata = {
  title: "Aylin Awsners — AI, refined.",
  description:
    "Aylin Awsners is an AI assistant with the full capabilities of Claude. Ask anything — writing, code, research, reasoning.",
  openGraph: {
    title: "Aylin Awsners",
    description: "AI, refined. Powered by Claude.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#140708",
  colorScheme: "dark",
};

export default function AylinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
