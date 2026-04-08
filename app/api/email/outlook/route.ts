/**
 * Outlook / Microsoft Graph API integration
 *
 * OAuth flow uses Authorization Code + PKCE
 * Required env vars:
 *   MICROSOFT_CLIENT_ID    - from Azure App Registration
 *   MICROSOFT_TENANT_ID    - "common" for personal accounts, or your tenant ID
 *   MICROSOFT_CLIENT_SECRET - client secret from Azure
 *   NEXTAUTH_URL           - your app base URL (e.g. http://localhost:3000)
 *
 * Token is stored in SQLite via a simple token store (not NextAuth, to keep it minimal).
 */

import { NextRequest, NextResponse } from "next/server";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface TokenStore {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// In-memory token cache (persists for the server process lifetime)
let tokenCache: TokenStore | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!tokenCache?.refreshToken) return null;

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    refresh_token: tokenCache.refreshToken,
    grant_type: "refresh_token",
    scope: "Mail.Read offline_access",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? "common"}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  if (!res.ok) return null;
  const data = await res.json();

  tokenCache = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokenCache.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return tokenCache.accessToken;
}

async function getAccessToken(): Promise<string | null> {
  if (!tokenCache) return null;
  if (Date.now() < tokenCache.expiresAt - 60000) return tokenCache.accessToken;
  return refreshAccessToken();
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // OAuth callback
  if (action === "callback") {
    const code = url.searchParams.get("code");
    if (!code) return NextResponse.json({ error: "No code" }, { status: 400 });

    const params = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      code,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/email/outlook?action=callback`,
      grant_type: "authorization_code",
      scope: "Mail.Read offline_access",
    });

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? "common"}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      }
    );

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      return NextResponse.json({ error: tokenData.error_description }, { status: 400 });
    }

    tokenCache = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    };

    return NextResponse.redirect(new URL("/", req.url));
  }

  // Auth URL generation
  if (action === "connect") {
    if (!process.env.MICROSOFT_CLIENT_ID) {
      return NextResponse.json({ error: "unconfigured" }, { status: 400 });
    }
    const authUrl = new URL(
      `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? "common"}/oauth2/v2.0/authorize`
    );
    authUrl.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID);
    authUrl.searchParams.set(
      "redirect_uri",
      `${process.env.NEXTAUTH_URL}/api/email/outlook?action=callback`
    );
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "Mail.Read offline_access");
    authUrl.searchParams.set("response_mode", "query");

    return NextResponse.redirect(authUrl.toString());
  }

  // Check if configured
  if (!process.env.MICROSOFT_CLIENT_ID) {
    return NextResponse.json({ status: "unconfigured", messages: [] });
  }

  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ status: "unauthenticated", messages: [] });
  }

  try {
    // Fetch unread count
    const unreadRes = await fetch(
      `${GRAPH_BASE}/me/mailFolders/inbox/messages?$filter=isRead eq false&$count=true&$top=1&$select=id`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ConsistencyLevel: "eventual",
        },
      }
    );

    const unreadData = await unreadRes.json();
    const unreadCount: number = unreadData["@odata.count"] ?? 0;

    // Fetch recent important messages
    const msgRes = await fetch(
      `${GRAPH_BASE}/me/mailFolders/inbox/messages?$top=10&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,isRead,importance,bodyPreview`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const msgData = await msgRes.json();
    const messages = (msgData.value ?? []).map(
      (m: {
        id: string;
        subject: string;
        from: { emailAddress: { name: string; address: string } };
        receivedDateTime: string;
        isRead: boolean;
        importance: string;
        bodyPreview: string;
      }) => ({
        id: m.id,
        subject: m.subject ?? "(no subject)",
        from: m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? "Unknown",
        receivedAt: m.receivedDateTime,
        isRead: m.isRead,
        isImportant: m.importance === "high",
        preview: m.bodyPreview?.slice(0, 120) ?? "",
      })
    );

    return NextResponse.json({ status: "connected", unreadCount, messages });
  } catch (error) {
    return NextResponse.json({ status: "error", error: String(error), messages: [] });
  }
}
