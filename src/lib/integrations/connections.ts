import type Database from "better-sqlite3";
import { decryptSecret, encryptSecret } from "@/lib/integrations/google-drive/crypto";

export type ConnectionId = "aircall" | "gohighlevel";

export type StoredConnection = {
  id: ConnectionId;
  organisationId: string | null;
  accountLabel: string | null;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
  lastSummary: string | null;
  hasSecret: boolean;
};

export function getConnection(db: Database.Database, id: ConnectionId): StoredConnection {
  const row = db.prepare(`SELECT * FROM ops_connections WHERE id = ?`).get(id) as
    | {
        organisation_id: string | null;
        account_label: string | null;
        secret_payload: string | null;
        status: string;
        last_sync_at: string | null;
        last_error: string | null;
        last_summary: string | null;
      }
    | undefined;
  if (!row) {
    return { id, organisationId: null, accountLabel: null, status: "disconnected", lastSyncAt: null, lastError: null, lastSummary: null, hasSecret: false };
  }
  return {
    id,
    organisationId: row.organisation_id,
    accountLabel: row.account_label,
    status: row.status,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    lastSummary: row.last_summary,
    hasSecret: Boolean(row.secret_payload),
  };
}

export function readSecret<T>(db: Database.Database, id: ConnectionId): T | null {
  const row = db.prepare(`SELECT secret_payload FROM ops_connections WHERE id = ?`).get(id) as { secret_payload: string | null } | undefined;
  if (!row?.secret_payload) return null;
  return JSON.parse(decryptSecret(row.secret_payload)) as T;
}

export function saveConnection(db: Database.Database, input: { id: ConnectionId; organisationId: string; accountLabel: string; secret?: unknown; status: string; error?: string | null }) {
  const now = new Date().toISOString();
  const existing = db.prepare(`SELECT secret_payload FROM ops_connections WHERE id = ?`).get(input.id) as { secret_payload: string | null } | undefined;
  const payload = input.secret ? encryptSecret(JSON.stringify(input.secret)) : existing?.secret_payload ?? null;
  if (!payload) throw new Error("The key is not stored yet.");
  db.prepare(
    `INSERT INTO ops_connections (id, organisation_id, account_label, secret_payload, status, last_error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       organisation_id = excluded.organisation_id,
       account_label = excluded.account_label,
       secret_payload = excluded.secret_payload,
       status = excluded.status,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  ).run(input.id, input.organisationId, input.accountLabel, payload, input.status, input.error ?? null, now);
  db.prepare(`UPDATE integrations SET status = ?, notes = ? WHERE id = ?`).run(
    input.status === "connected" ? "connected" : input.status === "error" ? "error" : "disconnected",
    input.error || (input.id === "aircall" ? "Read-only. Calls only. Nothing is written back." : "Read-only. Contacts and appointments. Nothing is written back."),
    input.id,
  );
}

export function markSync(db: Database.Database, id: ConnectionId, summary: string, error: string | null) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE ops_connections SET last_sync_at = ?, last_summary = ?, last_error = ?, status = ?, updated_at = ? WHERE id = ?`).run(
    now,
    summary,
    error,
    error ? "error" : "connected",
    now,
    id,
  );
  db.prepare(`UPDATE integrations SET status = ? WHERE id = ?`).run(error ? "error" : "connected", id);
}
