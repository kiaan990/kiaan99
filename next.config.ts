import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude Playwright from the Next.js bundle (it's only used in API routes server-side)
  serverExternalPackages: ["playwright", "playwright-core"],
  experimental: {
    // Allow server-side modules to import native binaries (better-sqlite3, etc.)
  },
};

export default nextConfig;
