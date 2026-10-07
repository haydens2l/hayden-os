import { decryptSecret, encryptSecret, googleConfig } from "@/lib/integrations/google-drive/crypto";
import { saveAccessToken } from "@/lib/integrations/google-drive/store";
import { FOLDER_MIME, type DriveItem, type DriveReader } from "@/lib/integrations/google-drive/types";
import type Database from "better-sqlite3";

const TEXT_MIMES = new Set(["text/plain", "text/csv", "text/markdown", "text/tab-separated-values"]);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function googleDriveReader(db: Database.Database, accessToken: string): DriveReader {
  return {
    async listChildren(parentId: string) {
      const items: DriveItem[] = [];
      let page: string | null = null;
      do {
        const url = new URL("https://www.googleapis.com/drive/v3/files");
        url.searchParams.set("q", `'${parentId.replaceAll("'", "")}' in parents and trashed = false`);
        url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size,parents)");
        url.searchParams.set("pageSize", "100");
        if (page) url.searchParams.set("pageToken", page);
        const body = await driveGet(db, accessToken, url);
        const files = (body.files ?? []) as DriveItem[];
        items.push(...files);
        page = (body.nextPageToken as string | undefined) ?? null;
      } while (page && items.length < 400);
      return items;
    },
    async readText(item: DriveItem) {
      if (item.mimeType === FOLDER_MIME || item.mimeType.startsWith("image/") || item.mimeType.startsWith("video/")) {
        return { text: null, mode: "metadata" as const };
      }
      if (item.mimeType === "application/vnd.google-apps.document") {
        return { text: await exportFile(db, accessToken, item.id, "text/plain"), mode: "text" as const };
      }
      if (item.mimeType === "application/vnd.google-apps.spreadsheet") {
        return { text: await exportFile(db, accessToken, item.id, "text/csv"), mode: "text" as const };
      }
      if (TEXT_MIMES.has(item.mimeType)) {
        return { text: await downloadText(db, accessToken, item.id), mode: "text" as const };
      }
      if (item.mimeType === "application/pdf" || item.mimeType === DOCX) {
        const bytes = await downloadBytes(db, accessToken, item.id);
        const text = await extractBinary(item.mimeType, bytes);
        return text ? { text, mode: "text" as const } : { text: null, mode: "metadata" as const };
      }
      return { text: null, mode: "metadata" as const };
    },
  };
}

export async function listRootFolders(db: Database.Database) {
  const token = await freshAccessToken(db);
  if (!token) return [];
  const reader = googleDriveReader(db, token);
  const children = await reader.listChildren("root");
  return children.filter((item) => item.mimeType === FOLDER_MIME);
}

export async function listChildFolders(db: Database.Database, parentId: string) {
  const token = await freshAccessToken(db);
  if (!token) return [];
  const children = await googleDriveReader(db, token).listChildren(parentId);
  return children.filter((item) => item.mimeType === FOLDER_MIME);
}

async function freshAccessToken(db: Database.Database) {
  const row = db.prepare(`SELECT access_token, refresh_token, token_expiry, status FROM drive_connections WHERE id = 'google-drive'`).get() as
    | { access_token: string | null; refresh_token: string | null; token_expiry: string | null; status: string }
    | undefined;
  if (!row || row.status !== "connected" || !row.access_token) return null;
  const access = decryptSecret(row.access_token);
  const expiry = row.token_expiry ? Date.parse(row.token_expiry) : 0;
  if (expiry > Date.now() + 60_000) return access;
  if (!row.refresh_token) return access;
  const config = googleConfig();
  if (!config) return access;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: decryptSecret(row.refresh_token),
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) return access;
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return access;
  const nextExpiry = new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString();
  saveAccessToken(db, body.access_token, nextExpiry);
  return body.access_token;
}

async function driveGet(db: Database.Database, accessToken: string, url: URL) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 401) {
    const refreshed = await freshAccessToken(db);
    if (!refreshed) throw new Error("Google Drive refused the read.");
    const retry = await fetch(url, { headers: { Authorization: `Bearer ${refreshed}` } });
    if (!retry.ok) throw new Error("Google Drive refused the read.");
    return (await retry.json()) as { files?: DriveItem[]; nextPageToken?: string };
  }
  if (!response.ok) throw new Error("Google Drive refused the read.");
  return (await response.json()) as { files?: DriveItem[]; nextPageToken?: string };
}

async function exportFile(db: Database.Database, accessToken: string, id: string, mime: string) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export`);
  url.searchParams.set("mimeType", mime);
  return readBody(db, accessToken, url);
}

async function downloadText(db: Database.Database, accessToken: string, id: string) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  url.searchParams.set("alt", "media");
  return readBody(db, accessToken, url);
}

async function downloadBytes(db: Database.Database, accessToken: string, id: string) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  url.searchParams.set("alt", "media");
  const response = await authorized(db, accessToken, url);
  return Buffer.from(await response.arrayBuffer());
}

async function readBody(db: Database.Database, accessToken: string, url: URL) {
  const response = await authorized(db, accessToken, url);
  return (await response.text()).slice(0, 60_000);
}

async function authorized(db: Database.Database, accessToken: string, url: URL) {
  let response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 401) {
    const refreshed = await freshAccessToken(db);
    if (!refreshed) throw new Error("Google Drive refused the read.");
    response = await fetch(url, { headers: { Authorization: `Bearer ${refreshed}` } });
  }
  if (!response.ok) throw new Error("Google Drive refused the read.");
  return response;
}

async function extractBinary(mime: string, bytes: Buffer) {
  try {
    if (mime === "application/pdf") {
      const unpdf = await import("unpdf");
      const pdf = await unpdf.getDocumentProxy(new Uint8Array(bytes));
      const extracted = await unpdf.extractText(pdf, { mergePages: true });
      return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    }
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: bytes });
    return result.value;
  } catch {
    return null;
  }
}

export function cipherRoundTrip(plain: string) {
  return decryptSecret(encryptSecret(plain)) === plain;
}
