import type Database from "better-sqlite3";

export type SyncState = {
  integration: string;
  cursor: string | null;
  lastAttemptedAt: string | null;
  lastSuccessfulAt: string | null;
  latestSourceAt: string | null;
  recordsAdded: number;
  recordsUpdated: number;
  transcriptsDiscovered: number;
  error: string | null;
  partialError: string | null;
  fullScanAt: string | null;
};

const EMPTY = (integration: string): SyncState => ({
  integration,
  cursor: null,
  lastAttemptedAt: null,
  lastSuccessfulAt: null,
  latestSourceAt: null,
  recordsAdded: 0,
  recordsUpdated: 0,
  transcriptsDiscovered: 0,
  error: null,
  partialError: null,
  fullScanAt: null,
});

export function readSyncState(db: Database.Database, integration: string): SyncState {
  const row = db.prepare(`SELECT * FROM ops_sync_state WHERE integration = ?`).get(integration) as Record<string, string | number | null> | undefined;
  if (!row) return EMPTY(integration);
  return {
    integration,
    cursor: (row.cursor as string | null) ?? null,
    lastAttemptedAt: (row.last_attempted_at as string | null) ?? null,
    lastSuccessfulAt: (row.last_successful_at as string | null) ?? null,
    latestSourceAt: (row.latest_source_at as string | null) ?? null,
    recordsAdded: Number(row.records_added ?? 0),
    recordsUpdated: Number(row.records_updated ?? 0),
    transcriptsDiscovered: Number(row.transcripts_discovered ?? 0),
    error: (row.error as string | null) ?? null,
    partialError: (row.partial_error as string | null) ?? null,
    fullScanAt: (row.full_scan_at as string | null) ?? null,
  };
}

export function writeSyncState(db: Database.Database, state: SyncState) {
  db.prepare(
    `INSERT INTO ops_sync_state (
      integration, cursor, last_attempted_at, last_successful_at, latest_source_at, records_added, records_updated,
      transcripts_discovered, error, partial_error, full_scan_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(integration) DO UPDATE SET
      cursor = excluded.cursor,
      last_attempted_at = excluded.last_attempted_at,
      last_successful_at = excluded.last_successful_at,
      latest_source_at = excluded.latest_source_at,
      records_added = excluded.records_added,
      records_updated = excluded.records_updated,
      transcripts_discovered = excluded.transcripts_discovered,
      error = excluded.error,
      partial_error = excluded.partial_error,
      full_scan_at = excluded.full_scan_at`,
  ).run(
    state.integration,
    state.cursor,
    state.lastAttemptedAt,
    state.lastSuccessfulAt,
    state.latestSourceAt,
    state.recordsAdded,
    state.recordsUpdated,
    state.transcriptsDiscovered,
    state.error,
    state.partialError,
    state.fullScanAt,
  );
}

export function tryLock(db: Database.Database) {
  const row = db.prepare(`SELECT lock_until FROM ops_sync_state WHERE integration = '_lock'`).get() as { lock_until: string | null } | undefined;
  const now = new Date();
  if (row?.lock_until && row.lock_until > now.toISOString()) return false;
  const until = new Date(now.getTime() + 8 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO ops_sync_state (integration, lock_until) VALUES ('_lock', ?)
     ON CONFLICT(integration) DO UPDATE SET lock_until = excluded.lock_until`,
  ).run(until);
  return true;
}

export function unlock(db: Database.Database) {
  db.prepare(`UPDATE ops_sync_state SET lock_until = NULL WHERE integration = '_lock'`).run();
}

export type HealthLabel = "CURRENT" | "DELAYED" | "STALE" | "ERROR";

export function healthLabel(state: SyncState, now = Date.now()): HealthLabel {
  if (state.error && (!state.lastSuccessfulAt || (state.lastAttemptedAt && state.lastAttemptedAt > state.lastSuccessfulAt))) return "ERROR";
  if (!state.lastSuccessfulAt) return "STALE";
  const age = now - Date.parse(state.lastSuccessfulAt);
  if (Number.isNaN(age)) return "STALE";
  if (age <= 15 * 60 * 1000) return "CURRENT";
  if (age <= 60 * 60 * 1000) return "DELAYED";
  return "STALE";
}
