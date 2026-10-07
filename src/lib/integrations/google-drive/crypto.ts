import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function driveScope() {
  return SCOPE;
}

export function redirectUri() {
  return process.env.GOOGLE_REDIRECT_URI?.trim() || "http://localhost:3210/api/integrations/google/callback";
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: redirectUri() };
}

export function buildAuthUrl(state: string) {
  const config = googleConfig();
  if (!config) return null;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("include_granted_scopes", "false");
  return url.toString();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string) {
  const buffer = Buffer.from(payload, "base64");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function tokenKey() {
  const secret = process.env.DRIVE_TOKEN_KEY?.trim();
  if (!secret) throw new Error("DRIVE_TOKEN_KEY is missing.");
  return scryptSync(secret, "hayden-os-drive", 32);
}
