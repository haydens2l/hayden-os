import type Database from "better-sqlite3";

const CHECKED = "2026-10-01T04:10:00.000Z";

const RECORDS = [
  ["aircall", "calls", "read", "GET /v1/calls returned 200. Direction, duration, user, timestamps, answered or missed, number, tags, and recording presence are on the call. Manual sync. Webhooks are not installed."],
  ["aircall", "transcripts", "read", "GET /v1/calls/:id/transcription returned 200 for 7 of 9 recent FIFO and IWG calls, and 404 when a transcript is not stored. Summaries on the sampled call returned 404. Comments endpoint returned 404. Tags can be present on the call. Nothing is written back."],
  ["aircall", "users and numbers", "read", "GET /v1/users and GET /v1/numbers returned 200. Line names are used to file FIFO Investor and IWG only."],
  ["gohighlevel", "pipelines", "read", "Pipelines, stages, opportunities, status, source, created date, stage-change date, assigned user id, and contact id, name, phone, and tags returned 200. Only Meta, Paid off home, and Brisbane Paid off are stored."],
  ["gohighlevel", "appointments", "read", "Calendars and events returned 200, including appointment status, contact, start, end, assigned user, and notes. Contact notes, tasks, and appointments returned 200."],
  ["gohighlevel", "conversations", "read", "Conversation search and message list returned 200. Message text is not copied into call-transcript signals."],
  ["gohighlevel", "custom fields and users", "read", "Custom fields and users returned 200. Users are used to name an appointment owner. Hayden OS does not move stages, change tags, send messages, or edit records."],
] as const;

export function capabilityRecords(db: Database.Database) {
  const now = CHECKED;
  const insert = db.prepare(
    `INSERT INTO ops_capabilities (id, integration, capability, access, detail, checked_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET access = excluded.access, detail = excluded.detail, checked_at = excluded.checked_at`,
  );
  for (const [integration, capability, access, detail] of RECORDS) {
    insert.run(`${integration}:${capability}`, integration, capability, access, detail, now);
  }
  return db.prepare(`SELECT * FROM ops_capabilities ORDER BY integration, capability`).all() as Array<{
    integration: string;
    capability: string;
    access: string;
    detail: string;
    checked_at: string;
  }>;
}
