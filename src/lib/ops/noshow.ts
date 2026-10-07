import type Database from "better-sqlite3";
import { saveOpsFinding } from "@/lib/ops/findings";
import { assignPeople } from "@/lib/ops/person";
import { personRecord } from "@/lib/work/people";

export type NoShowRow = {
  leadId: string | null;
  name: string | null;
  occurredAt: string | null;
  source: string;
  owner: string | null;
  confidence: string;
  recovery: string;
  attempts: number;
  organisationId: string;
};

export function rebuildNoShows(db: Database.Database) {
  assignPeople(db);
  const coverage = db.prepare(`SELECT MIN(occurred_at) AS start, MAX(occurred_at) AS end FROM ops_activities WHERE external_source = 'aircall'`).get() as { start: string | null; end: string | null };
  const now = new Date().toISOString();
  const stageRows = db.prepare(
    `SELECT id, name, organisation_id, person_id, owner_name, stage, stage_changed_at, external_id
     FROM ops_leads
     WHERE external_source = 'gohighlevel' AND lower(COALESCE(stage, '')) LIKE '%no show%'`,
  ).all() as Array<{ id: string; name: string | null; organisation_id: string; person_id: string | null; owner_name: string | null; stage: string; stage_changed_at: string | null; external_id: string | null }>;
  const appointmentRows = db.prepare(
    `SELECT a.id, a.lead_id, a.person_id, a.organisation_id, a.scheduled_at, a.setter_name, a.external_id, l.name, l.owner_name
     FROM ops_appointments a
     LEFT JOIN ops_leads l ON l.id = a.lead_id
     WHERE a.status = 'no_show'`,
  ).all() as Array<{ id: string; lead_id: string | null; person_id: string | null; organisation_id: string; scheduled_at: string | null; setter_name: string | null; external_id: string | null; name: string | null; owner_name: string | null }>;

  const upsert = db.prepare(
    `INSERT INTO ops_no_show_events (
      id, lead_id, person_id, appointment_id, organisation_id, occurred_at, source, source_record, owner_name, confidence, recovery_status, attempt_count, detail, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_record) DO UPDATE SET
      lead_id = excluded.lead_id,
      person_id = excluded.person_id,
      appointment_id = excluded.appointment_id,
      occurred_at = excluded.occurred_at,
      owner_name = excluded.owner_name,
      confidence = excluded.confidence,
      recovery_status = excluded.recovery_status,
      attempt_count = excluded.attempt_count,
      detail = excluded.detail,
      updated_at = excluded.updated_at`,
  );

  for (const row of appointmentRows) {
    const recovery = recoveryFor(db, coverage, row.person_id, row.scheduled_at, row.lead_id);
    upsert.run(crypto.randomUUID(), row.lead_id, row.person_id, row.id, row.organisation_id, row.scheduled_at, "appointment status", row.external_id || row.id, row.setter_name || row.owner_name, "high", recovery.status, recovery.attempts, recovery.detail, now);
  }
  for (const row of stageRows) {
    const appointment = db.prepare(`SELECT id, status, scheduled_at FROM ops_appointments WHERE lead_id = ? ORDER BY scheduled_at DESC LIMIT 1`).get(row.id) as { id: string; status: string; scheduled_at: string | null } | undefined;
    const recovery = recoveryFor(db, coverage, row.person_id, row.stage_changed_at, row.id);
    const calendar = appointment ? `Calendar status is ${appointment.status}, not no-show.` : "No calendar appointment is stored for this opportunity.";
    upsert.run(crypto.randomUUID(), row.id, row.person_id, appointment?.id ?? null, row.organisation_id, row.stage_changed_at, "pipeline stage", row.external_id || row.id, row.owner_name, "medium", recovery.status, recovery.attempts, `${row.stage}. ${calendar} ${recovery.detail}`, now);
  }

  const confirmed = db.prepare(`SELECT COUNT(*) AS n FROM ops_no_show_events WHERE recovery_status = 'CONFIRMED NO ATTEMPT'`).get() as { n: number };
  const unknown = db.prepare(`SELECT COUNT(*) AS n FROM ops_no_show_events WHERE recovery_status = 'UNKNOWN — INCOMPLETE DATA'`).get() as { n: number };
  const owner = personRecord(db, "ap") ? "ap" : null;
  if (confirmed.n) {
    const existing = db.prepare(`SELECT id FROM ops_findings WHERE finding_key = 'no-show-recovery-gap' AND status = 'open'`).get() as { id: string } | undefined;
    const what = `${confirmed.n} no-show records have call coverage after the event and no recovery call.`;
    const evidence = `Call history stored from ${coverage.start?.slice(0, 10) ?? "an unknown start"} through ${coverage.end?.slice(0, 10) ?? "an unknown end"}. ${unknown.n} other no-show records are unknown because call coverage does not include them.`;
    if (existing) {
      db.prepare(`UPDATE ops_findings SET what_happened = ?, evidence = ?, possible_causes = ?, confidence = ? WHERE id = ?`).run(what, evidence, "The person has no matched Aircall call after the no-show, and calls were being stored through that period.", "medium", existing.id);
    } else {
      saveOpsFinding(db, {
        organisationId: "fifo",
        key: "no-show-recovery-gap",
        severity: "action",
        what,
        evidence,
        why: "A no-show with coverage and no later call is sitting untouched.",
        causes: "The person has no matched Aircall call after the no-show, and calls were being stored through that period.",
        confidence: "medium",
        action: "Recover the no-shows that have no attempt.",
        ownerId: owner,
        hayden: false,
      });
    }
  }
  return { confirmed: confirmed.n, unknown: unknown.n, coverageStart: coverage.start, coverageEnd: coverage.end };
}

function recoveryFor(
  db: Database.Database,
  coverage: { start: string | null; end: string | null },
  personId: string | null,
  marker: string | null,
  leadId: string | null,
) {
  if (!marker || !coverage.start || !coverage.end || marker < coverage.start || marker > coverage.end || !personId) {
    return { status: "UNKNOWN — INCOMPLETE DATA", attempts: 0, detail: "Aircall coverage does not include the period after this no-show, so zero attempts is not claimed." };
  }
  const calls = db.prepare(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN outcome LIKE '%answered%' THEN 1 ELSE 0 END) AS connected
     FROM ops_activities WHERE person_id = ? AND external_source = 'aircall' AND occurred_at > ?`,
  ).get(personId, marker) as { n: number; connected: number | null };
  const rebooked = leadId
    ? (db.prepare(`SELECT COUNT(*) AS n FROM ops_appointments WHERE lead_id = ? AND status = 'booked' AND scheduled_at > ?`).get(leadId, marker) as { n: number }).n
    : 0;
  if (rebooked) return { status: "REBOOKED", attempts: calls.n, detail: "A later booked appointment is stored." };
  if ((calls.connected ?? 0) > 0) return { status: "CONNECTED", attempts: calls.n, detail: "A later call was answered." };
  if (calls.n > 0) return { status: "ATTEMPTED", attempts: calls.n, detail: "A later call was made and was not answered." };
  return { status: "CONFIRMED NO ATTEMPT", attempts: 0, detail: "Calls were being stored after this event, and none match this person." };
}

export function noShowRows(db: Database.Database) {
  return db.prepare(
    `SELECT e.lead_id, l.name, e.occurred_at, e.source, e.owner_name, e.confidence, e.recovery_status, e.attempt_count, e.organisation_id
     FROM ops_no_show_events e
     LEFT JOIN ops_leads l ON l.id = e.lead_id
     ORDER BY e.occurred_at DESC`,
  ).all() as Array<{ lead_id: string | null; name: string | null; occurred_at: string | null; source: string; owner_name: string | null; confidence: string; recovery_status: string; attempt_count: number; organisation_id: string }>;
}
