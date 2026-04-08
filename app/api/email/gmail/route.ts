/**
 * Gmail API integration (read-only) with AI summary
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface TokenStore {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let tokenCache: TokenStore | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!tokenCache?.refreshToken) return null;

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: tokenCache.refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) return null;
  const data = await res.json();

  tokenCache = {
    accessToken: data.access_token,
    refreshToken: tokenCache.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return tokenCache.accessToken;
}

async function getAccessToken(): Promise<string | null> {
  if (!tokenCache) return null;
  if (Date.now() < tokenCache.expiresAt - 60000) return tokenCache.accessToken;
  return refreshAccessToken();
}

async function generateSummary(emails: { subject: string; from: string; snippet: string; isImportant: boolean }[]): Promise<{ summary: string; actionItems: { subject: string; from: string; reason: string }[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { summary: "", actionItems: [] };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const emailList = emails
    .map((e, i) => `${i + 1}. From: ${e.from}\n   Subject: ${e.subject}\n   Preview: ${e.snippet}`)
    .join("\n\n");

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `You are analyzing someone's inbox. From these recent emails, identify ONLY the ones that require action or are genuinely important (deadlines, replies needed, bills, appointments, school-related, urgent requests). Ignore marketing, promotions, receipts, newsletters.

Emails:
${emailList}

Respond in this exact JSON format:
{
  "summary": "One sentence overview of what needs attention (or 'Nothing urgent' if nothing important)",
  "actionItems": [
    { "subject": "exact subject", "from": "sender name only", "reason": "why action needed, max 8 words" }
  ]
}

Return max 4 action items. Only include genuinely important ones.`,
      },
    ],
  });

  try {
    const text = msg.content[0].type === "text" ? msg.content[0].text : "";
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (json) return JSON.parse(json);
  } catch { /* fall through */ }

  return { summary: "", actionItems: [] };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // OAuth callback
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

    tokenCache = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
    };

    return NextResponse.redirect(new URL("/", req.url));
  }

  // Connect — redirect to Google OAuth
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
    return NextResponse.json({ status: "unconfigured" });
  }

  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ status: "unauthenticated" });
  }

  try {
    // Fetch unread count
    const profileRes = await fetch(`${GMAIL_BASE}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const profile = await profileRes.json();

    // Fetch recent unread messages
    const listRes = await fetch(
      `${GMAIL_BASE}/messages?q=is:unread in:inbox&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const listData = await listRes.json();
    const messageList: { id: string }[] = listData.messages ?? [];

    // Fetch message details (parallel)
    const messages = await Promise.all(
      messageList.slice(0, 20).map(async (m) => {
        const res = await fetch(
          `${GMAIL_BASE}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        const headers: { name: string; value: string }[] = data.payload?.headers ?? [];
        const get = (name: string) => headers.find((h) => h.name === name)?.value ?? "";

        const isImportant = data.labelIds?.includes("IMPORTANT") || data.labelIds?.includes("STARRED");
        const from = get("From").replace(/<[^>]+>/, "").trim().replace(/^"(.+)"$/, "$1");

        return {
          subject: get("Subject") || "(no subject)",
          from,
          snippet: data.snippet?.slice(0, 150) ?? "",
          isImportant,
        };
      })
    );

    // Generate AI summary
    const { summary, actionItems } = await generateSummary(messages);

    return NextResponse.json({
      status: "connected",
      unreadCount: profile.threadsUnread ?? 0,
      summary,
      actionItems,
    });
  } catch (error) {
    return NextResponse.json({ status: "error", error: String(error) });
  }
}
