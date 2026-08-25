/**
 * Gmail API integration (read-only)
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID     - from Google Cloud Console
 *   GOOGLE_CLIENT_SECRET - from Google Cloud Console
 *   NEXTAUTH_URL         - your app base URL (e.g. http://localhost:3000)
 *
 * OAuth2 tokens are persisted in SQLite so they survive server restarts.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadToken, persistToken } from "@/lib/token-store";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PROVIDER = "gmail";

interface TokenStore {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// In-memory cache to avoid DB hit on every request
let memCache: TokenStore | null = null;

async function getTokenFromStore(): Promise<TokenStore | null> {
  if (memCache) return memCache;
  const stored = await loadToken(PROVIDER);
  if (stored) memCache = stored;
  return memCache;
}

async function writeToken(token: TokenStore) {
  memCache = token;
  await persistToken(PROVIDER, token);
}

async function refreshAccessToken(): Promise<string | null> {
  const current = await getTokenFromStore();
  if (!current?.refreshToken) return null;

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: current.refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) return null;
  const data = await res.json();

  const updated: TokenStore = {
    accessToken: data.access_token,
    refreshToken: current.refreshToken, // Gmail refresh tokens don't rotate
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  await writeToken(updated);
  return updated.accessToken;
}

async function getAccessToken(): Promise<string | null> {
  const token = await getTokenFromStore();
  if (!token) return null;
  if (Date.now() < token.expiresAt - 60000) return token.accessToken;
  return refreshAccessToken();
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "callback") {
    const code = url.searchParams.get("code");
    if (!code) return NextResponse.json({ error: "No code" }, { status: 400 });

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/email/gmail?action=callback`,
      grant_type: "authorization_code",
    });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      return NextResponse.json({ error: tokenData.error_description }, { status: 400 });
    }

    await writeToken({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
    });

    return NextResponse.redirect(new URL("/", req.url));
  }

  if (action === "connect") {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return NextResponse.json({ error: "unconfigured" }, { status: 400 });
    }
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set(
      "redirect_uri",
      `${process.env.NEXTAUTH_URL}/api/email/gmail?action=callback`
    );
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.readonly");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    return NextResponse.redirect(authUrl.toString());
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ status: "unconfigured", messages: [] });
  }

  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ status: "unauthenticated", messages: [] });
  }

  try {
    const profileRes = await fetch(`${GMAIL_BASE}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const profile = await profileRes.json();

    const listRes = await fetch(
      `${GMAIL_BASE}/messages?q=is:unread in:inbox&maxResults=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const listData = await listRes.json();
    const messageList: { id: string }[] = listData.messages ?? [];

    const messages = await Promise.all(
      messageList.slice(0, 8).map(async (m) => {
        const res = await fetch(
          `${GMAIL_BASE}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        const headers: { name: string; value: string }[] = data.payload?.headers ?? [];
        const get = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
        const isImportant = data.labelIds?.includes("IMPORTANT") || data.labelIds?.includes("STARRED");
        return {
          id: m.id,
          subject: get("Subject") || "(no subject)",
          from: get("From"),
          receivedAt: get("Date"),
          isRead: false,
          isImportant,
          preview: data.snippet?.slice(0, 120) ?? "",
        };
      })
    );

    return NextResponse.json({
      status: "connected",
      unreadCount: profile.messagesUnread ?? 0,
      threadUnread: profile.threadsUnread ?? 0,
      messages,
    });
  } catch (error) {
    return NextResponse.json({ status: "error", error: String(error), messages: [] });
  }
}
