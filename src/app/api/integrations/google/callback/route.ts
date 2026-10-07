import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { googleConfig } from "@/lib/integrations/google-drive/crypto";
import { markConnectionError, saveConnection, takeOauthState } from "@/lib/integrations/google-drive/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const back = new URL("/settings/integrations/google-drive", origin);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const cookie = jar.get("gd_state")?.value;
  jar.delete("gd_state");
  if (!code || !state || !cookie || state !== cookie || !takeOauthState(getDb(), state)) {
    back.searchParams.set("error", "state");
    return NextResponse.redirect(back);
  }
  const config = googleConfig();
  if (!config) {
    back.searchParams.set("error", "missing_client");
    return NextResponse.redirect(back);
  }
  try {
    const tokens = await exchangeCode(config, code);
    const email = await accountEmail(tokens.accessToken);
    saveConnection(getDb(), {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      email,
      expiry: tokens.expiry,
    });
  } catch {
    markConnectionError(getDb(), "Google Drive connection failed.");
    back.searchParams.set("error", "exchange");
    return NextResponse.redirect(back);
  }
  return NextResponse.redirect(back);
}

async function exchangeCode(config: { clientId: string; clientSecret: string; redirectUri: string }, code: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error("Google token exchange failed.");
  const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google token exchange failed.");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiry: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
  };
}

async function accountEmail(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { user?: { emailAddress?: string } };
  return body.user?.emailAddress ?? null;
}
