import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { buildAuthUrl, googleConfig } from "@/lib/integrations/google-drive/crypto";
import { saveOauthState } from "@/lib/integrations/google-drive/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const back = new URL("/settings/integrations/google-drive", origin);
  if (!googleConfig() || !buildAuthUrl("unused")) {
    back.searchParams.set("error", "missing_client");
    return NextResponse.redirect(back);
  }
  const state = crypto.randomUUID();
  saveOauthState(getDb(), state);
  const jar = await cookies();
  jar.set("gd_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 900 });
  const url = buildAuthUrl(state);
  if (!url || url.includes("client_secret")) {
    back.searchParams.set("error", "missing_client");
    return NextResponse.redirect(back);
  }
  return NextResponse.redirect(url);
}
