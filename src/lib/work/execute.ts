import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { assetRoot } from "@/lib/executor/storage";
import { setPackStatus, updateChecklist } from "@/lib/factory/store";
import { returnToCreative } from "@/lib/factory/loops";
import { isExecutor, personRecord, roleNote } from "@/lib/work/people";
import { proposeRule } from "@/lib/work/rules";
import { getWork } from "@/lib/work/state";

const CREATIVE_REASONS = ["concept issue", "hook issue", "script issue", "format issue", "production infeasibility"] as const;

export function assignExecution(db: Database.Database, packId: string, ownerId: string) {
  if (!isExecutor(ownerId)) throw new Error("That person is not a stored executor.");
  const linked = db.prepare(`SELECT id, stage FROM content_items WHERE legacy_pack_id = ? OR concept_id = (SELECT creative_concept_id FROM production_packs WHERE id = ?)`).get(packId, packId) as { id: string; stage: string } | undefined;
  if (linked && linked.stage !== "LEGACY" && !db.prepare(`SELECT id FROM visual_locks WHERE content_id = ?`).get(linked.id)) {
    throw new Error("This content has no approved storyboard. Lily or Danny do not receive an undefined idea.");
  }
  const person = personRecord(db, ownerId);
  if (!person) throw new Error("That person is not stored.");
  const pack = db.prepare(`SELECT id, status FROM production_packs WHERE id = ?`).get(packId) as { id: string; status: string } | undefined;
  if (!pack) throw new Error("That production pack is not stored.");
  if (pack.status === "complete" || pack.status === "archived") throw new Error("That work is already closed.");
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE production_packs SET production_owner = ?, assigned_at = ?, status = 'assigned', updated_at = ? WHERE id = ?`,
  ).run(ownerId, now, now, packId);
  clearBlocker(db, "production_pack", packId);
  return { ownerId, note: roleNote(db, ownerId, "production_pack") };
}

export function startWork(db: Database.Database, packId: string) {
  const pack = requirePack(db, packId);
  if (pack.status === "in_production") return;
  if (!["assigned", "blocked"].includes(pack.status) && latestReview(db, packId) !== "changes") {
    throw new Error("This is not ready to start.");
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE production_packs SET status = 'in_production', updated_at = ? WHERE id = ?`).run(now, packId);
  clearBlocker(db, "production_pack", packId);
}

export function blockerNeedsHayden(reason: string, waitingOn: string) {
  const text = `${reason} ${waitingOn}`.toLowerCase();
  if (/\bhayden\b|\bfounder\b|your decision/.test(text)) return true;
  return false;
}

export function markBlocked(db: Database.Database, packId: string, reason: string, waitingOn: string) {
  const cleanReason = reason.trim();
  const cleanWaiting = waitingOn.trim();
  if (!cleanReason || !cleanWaiting) throw new Error("A blocker needs a reason and who it is waiting on.");
  requirePack(db, packId);
  const now = new Date().toISOString();
  clearBlocker(db, "production_pack", packId);
  const needs = blockerNeedsHayden(cleanReason, cleanWaiting);
  db.prepare(
    `INSERT INTO work_blockers (id, source_type, source_id, reason, waiting_on, needs_hayden, created_at)
     VALUES (?, 'production_pack', ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), packId, cleanReason, cleanWaiting, needs ? 1 : 0, now);
  db.prepare(`UPDATE production_packs SET status = 'blocked', updated_at = ? WHERE id = ?`).run(now, packId);
  return needs;
}

export function addWorkNote(db: Database.Database, packId: string, authorId: string, body: string) {
  const text = body.trim();
  if (!text) throw new Error("Write the note first.");
  requirePack(db, packId);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO work_notes (id, source_type, source_id, author_id, body, created_at) VALUES (?, 'production_pack', ?, ?, ?, ?)`).run(
    crypto.randomUUID(),
    packId,
    authorId,
    text,
    now,
  );
  db.prepare(`UPDATE production_packs SET updated_at = ? WHERE id = ?`).run(now, packId);
}

export function submitWork(
  db: Database.Database,
  packId: string,
  input: { by: string; note?: string | null; link?: string | null; filePath?: string | null; fileName?: string | null; assetId?: string | null },
) {
  const pack = requirePack(db, packId);
  if (!pack.production_owner) throw new Error("Assign someone before they submit.");
  const note = input.note?.trim() || null;
  const link = input.link?.trim() || null;
  const filePath = input.filePath?.trim() || null;
  if (!note && !link && !filePath && !input.assetId) throw new Error("Add a note, a link, or a file.");
  const version = nextVersion(db, packId);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO work_submissions (
      id, source_type, source_id, version, note, link, file_path, file_name, asset_id, submitted_by, submitted_at, review_status
    ) VALUES (?, 'production_pack', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(crypto.randomUUID(), packId, version, note, link, filePath, input.fileName ?? null, input.assetId ?? null, input.by, now);
  const checklist = JSON.parse(pack.checklist || "{}") as Record<string, boolean>;
  checklist.readyForReview = true;
  updateChecklist(db, packId, checklist as never);
  clearBlocker(db, "production_pack", packId);
  return version;
}

export function requestChanges(db: Database.Database, packId: string, feedback: string) {
  const text = feedback.trim();
  if (!text) throw new Error("Write what needs to change.");
  const latest = latestSubmission(db, packId);
  if (!latest || latest.review_status !== "pending") throw new Error("Nothing is waiting for review.");
  const now = new Date().toISOString();
  db.prepare(`UPDATE work_submissions SET review_status = 'changes', feedback = ?, reviewed_at = ?, reviewed_by = 'hayden' WHERE id = ?`).run(
    text,
    now,
    latest.id,
  );
  const pack = requirePack(db, packId);
  const checklist = JSON.parse(pack.checklist || "{}") as Record<string, boolean>;
  checklist.readyForReview = false;
  db.prepare(`UPDATE production_packs SET status = 'in_production', checklist = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(checklist),
    now,
    packId,
  );
  const proposal = proposeRule(text, pack.brand);
  let suggestionId: string | null = null;
  if (proposal) {
    suggestionId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO rule_suggestions (id, source_type, source_id, feedback, title, body, organisation_id, status, created_at)
       VALUES (?, 'production_pack', ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(suggestionId, packId, text, proposal.title, proposal.body, pack.organisation_id, now);
  }
  return { version: latest.version, suggestionId };
}

export function approveDeliverable(db: Database.Database, packId: string) {
  const latest = latestSubmission(db, packId);
  if (!latest || latest.review_status !== "pending") throw new Error("Nothing is waiting for review.");
  const now = new Date().toISOString();
  db.prepare(`UPDATE work_submissions SET review_status = 'approved', reviewed_at = ?, reviewed_by = 'hayden' WHERE id = ?`).run(now, latest.id);
  setPackStatus(db, packId, "complete", "hayden");
  const versions = db.prepare(`SELECT COUNT(*) AS n FROM work_submissions WHERE source_type = 'production_pack' AND source_id = ?`).get(packId) as { n: number };
  const feedback = db
    .prepare(`SELECT COUNT(*) AS n FROM work_submissions WHERE source_type = 'production_pack' AND source_id = ? AND feedback IS NOT NULL`)
    .get(packId) as { n: number };
  const blocked = db
    .prepare(
      `SELECT created_at, cleared_at FROM work_blockers WHERE source_type = 'production_pack' AND source_id = ? ORDER BY created_at`,
    )
    .all(packId) as Array<{ created_at: string; cleared_at: string | null }>;
  const blockedNote = blocked.length
    ? blocked
        .map((row) => {
          const end = row.cleared_at ? new Date(row.cleared_at).getTime() : nowTime(now);
          const days = Math.max(0, Math.round((end - new Date(row.created_at).getTime()) / 86400000));
          return row.cleared_at ? `Blocked for about ${days} day${days === 1 ? "" : "s"}.` : "A blocker was still open when this finished.";
        })
        .join(" ")
    : "No blocker was recorded.";
  const pack = requirePack(db, packId);
  const summary = `Completed. ${versions.n} version${versions.n === 1 ? "" : "s"}. Executed by ${pack.production_owner ?? "unassigned"}. Feedback rounds: ${feedback.n}. ${blockedNote} Completion is not a performance result.`;
  db.prepare(
    `INSERT INTO work_outcomes (id, source_type, source_id, completed_at, executor_id, version_count, feedback_count, blocked_note, summary)
     VALUES (?, 'production_pack', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), packId, now, pack.production_owner, versions.n, feedback.n, blockedNote, summary);
  return { asset: latest.file_path || latest.link || latest.file_name, summary };
}

export function cancelWork(db: Database.Database, packId: string) {
  const pack = requirePack(db, packId);
  if (pack.status === "complete") throw new Error("Finished work stays finished.");
  const now = new Date().toISOString();
  db.prepare(`UPDATE production_packs SET status = 'archived', updated_at = ? WHERE id = ?`).run(now, packId);
  db.prepare(
    `INSERT INTO work_outcomes (id, source_type, source_id, completed_at, executor_id, version_count, feedback_count, blocked_note, summary)
     VALUES (?, 'production_pack', ?, ?, ?, 0, 0, NULL, ?)`,
  ).run(crypto.randomUUID(), packId, now, pack.production_owner, "Marked not worth doing. No performance result is stored.");
}

export async function returnWorkToCreative(db: Database.Database, packId: string, reason: string) {
  const text = reason.trim();
  if (!text) throw new Error("Say why the concept cannot be executed.");
  addWorkNote(db, packId, "executor", `Return to creative: ${text}`);
  const mapped = CREATIVE_REASONS.find((item) => text.toLowerCase().includes(item)) ?? mapReason(text);
  return returnToCreative(db, packId, mapped);
}

export function storeDeliverableFile(packId: string, bytes: Buffer, fileName: string) {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "deliverable";
  const dir = path.join(assetRoot(), "deliverables", packId);
  fs.mkdirSync(dir, { recursive: true });
  const stored = path.join(dir, `${crypto.randomUUID()}-${safe}`);
  fs.writeFileSync(stored, bytes);
  return stored;
}

export function listSubmissions(db: Database.Database, packId: string) {
  return db
    .prepare(
      `SELECT id, version, note, link, file_path, file_name, asset_id, submitted_by, submitted_at, review_status, feedback, reviewed_at
       FROM work_submissions WHERE source_type = 'production_pack' AND source_id = ? ORDER BY version`,
    )
    .all(packId) as Array<{
    id: string;
    version: number;
    note: string | null;
    link: string | null;
    file_path: string | null;
    file_name: string | null;
    asset_id: string | null;
    submitted_by: string;
    submitted_at: string;
    review_status: string;
    feedback: string | null;
    reviewed_at: string | null;
  }>;
}

export function listNotes(db: Database.Database, packId: string) {
  return db
    .prepare(`SELECT author_id, body, created_at FROM work_notes WHERE source_type = 'production_pack' AND source_id = ? ORDER BY created_at`)
    .all(packId) as Array<{ author_id: string; body: string; created_at: string }>;
}

export function workSnapshot(db: Database.Database, packId: string) {
  return getWork(db, "production_pack", packId);
}

function mapReason(text: string) {
  const lower = text.toLowerCase();
  if (/hook/.test(lower)) return "hook issue";
  if (/script/.test(lower)) return "script issue";
  if (/format/.test(lower)) return "format issue";
  if (/concept|idea|direction/.test(lower)) return "concept issue";
  return "production infeasibility";
}

function requirePack(db: Database.Database, packId: string) {
  const pack = db.prepare(`SELECT id, status, production_owner, checklist, brand, organisation_id FROM production_packs WHERE id = ?`).get(packId) as
    | {
        id: string;
        status: string;
        production_owner: string | null;
        checklist: string | null;
        brand: string | null;
        organisation_id: string | null;
      }
    | undefined;
  if (!pack) throw new Error("That production pack is not stored.");
  return pack;
}

function latestSubmission(db: Database.Database, packId: string) {
  return db
    .prepare(
      `SELECT id, version, review_status, file_path, link, file_name FROM work_submissions
       WHERE source_type = 'production_pack' AND source_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(packId) as { id: string; version: number; review_status: string; file_path: string | null; link: string | null; file_name: string | null } | undefined;
}

function latestReview(db: Database.Database, packId: string) {
  return latestSubmission(db, packId)?.review_status ?? null;
}

function nextVersion(db: Database.Database, packId: string) {
  const row = db
    .prepare(`SELECT COALESCE(MAX(version), 0) AS n FROM work_submissions WHERE source_type = 'production_pack' AND source_id = ?`)
    .get(packId) as { n: number };
  return row.n + 1;
}

function clearBlocker(db: Database.Database, sourceType: string, sourceId: string) {
  db.prepare(`UPDATE work_blockers SET cleared_at = ? WHERE source_type = ? AND source_id = ? AND cleared_at IS NULL`).run(
    new Date().toISOString(),
    sourceType,
    sourceId,
  );
}

function nowTime(iso: string) {
  return new Date(iso).getTime();
}
