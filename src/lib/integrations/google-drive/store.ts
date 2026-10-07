import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { classifyDocument } from "@/lib/integrations/google-drive/classify";
import { decryptSecret, driveScope, encryptSecret, googleConfig } from "@/lib/integrations/google-drive/crypto";
import { FOLDER_MIME, SYNC_FILE_LIMIT, TEXT_LIMIT, type DriveConnectionStatus, type DriveItem, type DriveReader } from "@/lib/integrations/google-drive/types";
import type { Organisation, Project } from "@/lib/db/types";

const CONNECTION_ID = "google-drive";

export type PublicDriveFile = {
  id: string;
  drive_file_id: string;
  name: string;
  mime_type: string | null;
  folder_path: string | null;
  modified_time: string | null;
  web_url: string | null;
  size: number | null;
  organisation_id: string | null;
  organisation_name: string | null;
  project_id: string | null;
  brand: string | null;
  knowledge_category: string | null;
  classification_confidence: string | null;
  index_status: string;
  content_text: string | null;
};

export function connectionStatus(db: Database.Database): DriveConnectionStatus {
  const row = db
    .prepare(
      `SELECT status, account_email, last_sync_at, last_error
       FROM drive_connections WHERE id = ?`,
    )
    .get(CONNECTION_ID) as
    | { status: string; account_email: string | null; last_sync_at: string | null; last_error: string | null }
    | undefined;
  const files = db.prepare(`SELECT COUNT(*) AS n FROM drive_files WHERE index_status != 'unavailable'`).get() as { n: number };
  const folders = db.prepare(`SELECT COUNT(DISTINCT folder_id) AS n FROM drive_files WHERE index_status != 'unavailable' AND folder_id IS NOT NULL`).get() as { n: number };
  const sources = db.prepare(`SELECT COUNT(*) AS n FROM drive_sources WHERE approved = 1`).get() as { n: number };
  return {
    status: row?.status === "connected" || row?.status === "error" ? row.status : "disconnected",
    accountEmail: row?.account_email ?? null,
    lastSync: row?.last_sync_at ?? null,
    lastError: row?.last_error ?? null,
    filesIndexed: files.n,
    foldersIndexed: Math.max(folders.n, sources.n),
    configured: googleConfig() != null,
    scope: driveScope(),
  };
}

export function saveConnection(
  db: Database.Database,
  input: { accessToken: string; refreshToken: string | null; email: string | null; expiry: string | null },
) {
  const now = new Date().toISOString();
  const existing = db.prepare(`SELECT refresh_token FROM drive_connections WHERE id = ?`).get(CONNECTION_ID) as
    | { refresh_token: string | null }
    | undefined;
  const refresh = input.refreshToken ? encryptSecret(input.refreshToken) : existing?.refresh_token ?? null;
  db.prepare(
    `INSERT INTO drive_connections (
      id, status, account_email, access_token, refresh_token, token_expiry, scope, last_error, updated_at
    ) VALUES (?, 'connected', ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = 'connected',
      account_email = excluded.account_email,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expiry = excluded.token_expiry,
      scope = excluded.scope,
      last_error = NULL,
      updated_at = excluded.updated_at`,
  ).run(CONNECTION_ID, input.email, encryptSecret(input.accessToken), refresh, input.expiry, driveScope(), now);
  db.prepare(`UPDATE integrations SET status = 'connected' WHERE id = ?`).run(CONNECTION_ID);
}

export function markConnectionError(db: Database.Database, message: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO drive_connections (id, status, last_error, updated_at)
     VALUES (?, 'error', ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = 'error', last_error = excluded.last_error, updated_at = excluded.updated_at`,
  ).run(CONNECTION_ID, message.slice(0, 180), now);
  db.prepare(`UPDATE integrations SET status = 'error' WHERE id = ?`).run(CONNECTION_ID);
}

export function disconnectDrive(db: Database.Database) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE drive_connections
     SET status = 'disconnected', account_email = NULL, access_token = NULL, refresh_token = NULL,
         token_expiry = NULL, last_error = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(now, CONNECTION_ID);
  db.prepare(`UPDATE integrations SET status = 'disconnected' WHERE id = ?`).run(CONNECTION_ID);
}

export function readTokens(db: Database.Database) {
  const row = db
    .prepare(`SELECT access_token, refresh_token, token_expiry, status FROM drive_connections WHERE id = ?`)
    .get(CONNECTION_ID) as
    | { access_token: string | null; refresh_token: string | null; token_expiry: string | null; status: string }
    | undefined;
  if (!row || row.status !== "connected" || !row.access_token) return null;
  return {
    accessToken: decryptSecret(row.access_token),
    refreshToken: row.refresh_token ? decryptSecret(row.refresh_token) : null,
    expiry: row.token_expiry,
  };
}

export function saveAccessToken(db: Database.Database, accessToken: string, expiry: string | null) {
  db.prepare(`UPDATE drive_connections SET access_token = ?, token_expiry = ?, updated_at = ? WHERE id = ?`).run(
    encryptSecret(accessToken),
    expiry,
    new Date().toISOString(),
    CONNECTION_ID,
  );
}

export function listSources(db: Database.Database) {
  return db.prepare(`SELECT id, drive_folder_id, name, path FROM drive_sources WHERE approved = 1 ORDER BY name`).all() as Array<{
    id: string;
    drive_folder_id: string;
    name: string;
    path: string | null;
  }>;
}

export function approveSource(db: Database.Database, input: { folderId: string; name: string; path: string | null }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO drive_sources (id, drive_folder_id, name, path, approved, created_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(drive_folder_id) DO UPDATE SET name = excluded.name, path = excluded.path, approved = 1`,
  ).run(crypto.randomUUID(), input.folderId, input.name, input.path, now);
}

export function removeSource(db: Database.Database, folderId: string) {
  db.prepare(`DELETE FROM drive_sources WHERE drive_folder_id = ?`).run(folderId);
}

export async function syncApprovedFolders(db: Database.Database, reader: DriveReader, trigger = "manual") {
  const started = new Date().toISOString();
  const runId = crypto.randomUUID();
  const sources = listSources(db);
  const organisations = db.prepare(`SELECT id, name, slug, type FROM organisations WHERE status = 'active'`).all() as Organisation[];
  const projects = db.prepare(`SELECT id, name FROM projects`).all() as Project[];
  let filesNew = 0;
  let filesModified = 0;
  let filesRemoved = 0;
  let error: string | null = null;
  const seen = new Set<string>();
  try {
    let count = 0;
    for (const source of sources) {
      const found = await walk(reader, source.drive_folder_id, source.name, source.drive_folder_id);
      for (const item of found) {
        if (count >= SYNC_FILE_LIMIT) break;
        count += 1;
        seen.add(item.file.id);
        const outcome = await upsertFile(db, item, organisations, projects, reader);
        if (outcome === "new") filesNew += 1;
        if (outcome === "modified") filesModified += 1;
      }
    }
    if (sources.length > 0) {
      const current = db
        .prepare(`SELECT drive_file_id FROM drive_files WHERE index_status != 'unavailable' AND source_folder_id IS NOT NULL`)
        .all() as Array<{ drive_file_id: string }>;
      const now = new Date().toISOString();
      for (const row of current) {
        if (seen.has(row.drive_file_id)) continue;
        db.prepare(`UPDATE drive_files SET index_status = 'unavailable', removed_at = ?, last_checked = ? WHERE drive_file_id = ?`).run(now, now, row.drive_file_id);
        filesRemoved += 1;
      }
    }
    db.prepare(`UPDATE drive_connections SET last_sync_at = ?, last_error = NULL, status = 'connected', updated_at = ? WHERE id = ?`).run(
      started,
      started,
      CONNECTION_ID,
    );
  } catch (caught) {
    error = caught instanceof Error ? caught.message.slice(0, 180) : "Sync failed.";
    markConnectionError(db, error);
  }
  db.prepare(
    `INSERT INTO drive_sync_runs (id, trigger, started_at, finished_at, files_new, files_modified, files_removed, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(runId, trigger, started, new Date().toISOString(), filesNew, filesModified, filesRemoved, error);
  return { filesNew, filesModified, filesRemoved, error };
}

async function walk(reader: DriveReader, folderId: string, path: string, sourceFolderId: string, depth = 0): Promise<Array<{ file: DriveItem; folderId: string; folderPath: string; sourceFolderId: string }>> {
  if (depth > 6) return [];
  const children = await reader.listChildren(folderId);
  const found: Array<{ file: DriveItem; folderId: string; folderPath: string; sourceFolderId: string }> = [];
  for (const child of children) {
    if (child.mimeType === FOLDER_MIME) {
      found.push(...(await walk(reader, child.id, `${path} / ${child.name}`, sourceFolderId, depth + 1)));
    } else {
      found.push({ file: child, folderId, folderPath: path, sourceFolderId });
    }
  }
  return found;
}

async function upsertFile(
  db: Database.Database,
  item: { file: DriveItem; folderId: string; folderPath: string; sourceFolderId: string },
  organisations: Organisation[],
  projects: Project[],
  reader: DriveReader,
) {
  const existing = db.prepare(`SELECT id, modified_time, content_hash FROM drive_files WHERE drive_file_id = ?`).get(item.file.id) as
    | { id: string; modified_time: string | null; content_hash: string | null }
    | undefined;
  const now = new Date().toISOString();
  if (existing && existing.modified_time === (item.file.modifiedTime ?? null)) {
    db.prepare(`UPDATE drive_files SET last_checked = ?, folder_path = ?, index_status = CASE WHEN index_status = 'unavailable' THEN 'indexed' ELSE index_status END, removed_at = NULL WHERE id = ?`).run(
      now,
      item.folderPath,
      existing.id,
    );
    return "unchanged" as const;
  }
  const read = await reader.readText(item.file);
  const text = read.text ? read.text.slice(0, TEXT_LIMIT) : null;
  const hash = text ? createHash("sha256").update(text).digest("hex") : null;
  if (existing && existing.content_hash === hash && existing.modified_time === (item.file.modifiedTime ?? null)) return "unchanged" as const;
  const classified = classifyDocument({ name: item.file.name, folderPath: item.folderPath, text }, organisations, projects);
  const status = read.mode === "metadata" ? "metadata_only" : "indexed";
  const size = item.file.size ? Number(item.file.size) : null;
  if (!existing) {
    db.prepare(
      `INSERT INTO drive_files (
        id, drive_file_id, name, mime_type, folder_id, folder_path, modified_time, web_url, size, indexed_at, last_checked,
        content_hash, content_text, organisation_id, project_id, brand, knowledge_category, classification_confidence,
        index_status, source_folder_id, removed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      crypto.randomUUID(),
      item.file.id,
      item.file.name,
      item.file.mimeType,
      item.folderId,
      item.folderPath,
      item.file.modifiedTime ?? null,
      item.file.webViewLink ?? `https://drive.google.com/file/d/${item.file.id}/view`,
      Number.isFinite(size) ? size : null,
      now,
      now,
      hash,
      text,
      classified.organisationId,
      classified.projectId,
      classified.brand,
      classified.category,
      classified.confidence,
      status,
      item.sourceFolderId,
    );
    return "new" as const;
  }
  db.prepare(
    `UPDATE drive_files SET
      name = ?, mime_type = ?, folder_id = ?, folder_path = ?, modified_time = ?, web_url = ?, size = ?,
      indexed_at = ?, last_checked = ?, content_hash = ?, content_text = ?, organisation_id = ?, project_id = ?,
      brand = ?, knowledge_category = ?, classification_confidence = ?, index_status = ?, removed_at = NULL
     WHERE id = ?`,
  ).run(
    item.file.name,
    item.file.mimeType,
    item.folderId,
    item.folderPath,
    item.file.modifiedTime ?? null,
    item.file.webViewLink ?? `https://drive.google.com/file/d/${item.file.id}/view`,
    Number.isFinite(size) ? size : null,
    now,
    now,
    hash,
    text,
    classified.organisationId,
    classified.projectId,
    classified.brand,
    classified.category,
    classified.confidence,
    status,
    existing.id,
  );
  return "modified" as const;
}

export function searchDriveFiles(
  db: Database.Database,
  filters: { query?: string; organisationId?: string; brand?: string; category?: string; mime?: string; modifiedAfter?: string },
) {
  const rows = db
    .prepare(
      `SELECT f.*, o.name AS organisation_name
       FROM drive_files f
       LEFT JOIN organisations o ON o.id = f.organisation_id
       WHERE f.index_status != 'unavailable'
       ORDER BY f.modified_time DESC
       LIMIT 200`,
    )
    .all() as PublicDriveFile[];
  const tokens = (filters.query ?? "").toLowerCase().split(/\W+/).filter((token) => token.length > 3 && !QUERY_STOP.has(token));
  return rows
    .filter((row) => !filters.organisationId || row.organisation_id === filters.organisationId)
    .filter((row) => !filters.brand || row.brand === filters.brand || row.organisation_id === filters.brand)
    .filter((row) => !filters.category || row.knowledge_category === filters.category)
    .filter((row) => !filters.mime || (row.mime_type ?? "").includes(filters.mime))
    .filter((row) => !filters.modifiedAfter || (row.modified_time ?? "") >= filters.modifiedAfter)
    .map((row) => ({ row, score: scoreFile(row, tokens) }))
    .filter((item) => tokens.length === 0 || item.score > 0)
    .sort((a, b) => b.score - a.score || (b.row.modified_time ?? "").localeCompare(a.row.modified_time ?? ""))
    .slice(0, 20);
}

const QUERY_STOP = new Set(["what", "that", "this", "with", "from", "have", "your", "about", "were", "does", "know", "said", "latest", "agreed", "there", "their", "would", "could", "should", "where", "which", "when", "into", "them", "they"]);

function scoreFile(row: PublicDriveFile, tokens: string[]) {
  if (tokens.length === 0) return 1;
  const name = row.name.toLowerCase();
  const path = (row.folder_path ?? "").toLowerCase();
  const body = (row.content_text ?? "").toLowerCase();
  return tokens.reduce((sum, token) => {
    if (name.includes(token)) return sum + 5;
    if (path.includes(token)) return sum + 3;
    if (body.includes(token)) return sum + 1;
    return sum;
  }, 0);
}

export function excerptFor(row: PublicDriveFile, query: string) {
  const text = row.content_text ?? "";
  if (!text) return "Indexed by name and date. The file contents are not stored.";
  const tokens = query.toLowerCase().split(/\W+/).filter((token) => token.length > 3 && !QUERY_STOP.has(token));
  const lower = text.toLowerCase();
  const at = tokens.map((token) => lower.indexOf(token)).find((index) => index >= 0) ?? 0;
  const start = Math.max(0, at - 80);
  return text.slice(start, start + 420).trim();
}

export function linkProjectSource(
  db: Database.Database,
  input: { projectId: string; driveFileRowId?: string | null; folderId?: string | null; label: string; webUrl?: string | null },
) {
  db.prepare(
    `INSERT INTO project_drive_links (id, project_id, drive_file_id, drive_folder_id, label, web_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), input.projectId, input.driveFileRowId ?? null, input.folderId ?? null, input.label, input.webUrl ?? null, new Date().toISOString());
}

export function listProjectLinks(db: Database.Database, projectId?: string) {
  const sql = projectId
    ? `SELECT * FROM project_drive_links WHERE project_id = ? ORDER BY created_at DESC`
    : `SELECT * FROM project_drive_links ORDER BY created_at DESC`;
  return (projectId ? db.prepare(sql).all(projectId) : db.prepare(sql).all()) as Array<{
    id: string;
    project_id: string;
    label: string;
    web_url: string | null;
    drive_folder_id: string | null;
  }>;
}

export function saveOauthState(db: Database.Database, state: string) {
  const now = new Date().toISOString();
  db.prepare(`DELETE FROM oauth_states WHERE created_at < ?`).run(new Date(Date.now() - 15 * 60 * 1000).toISOString());
  db.prepare(`INSERT INTO oauth_states (state, created_at) VALUES (?, ?)`).run(state, now);
}

export function takeOauthState(db: Database.Database, state: string) {
  const row = db.prepare(`SELECT state FROM oauth_states WHERE state = ?`).get(state) as { state: string } | undefined;
  if (!row) return false;
  db.prepare(`DELETE FROM oauth_states WHERE state = ?`).run(state);
  return true;
}
