import type Database from "better-sqlite3";
import { attendanceConcerns, drillShowRate, showRate, unattendedNoShows, type AppointmentRow } from "@/lib/ops/analyse";
import { personRecord } from "@/lib/work/people";

export type OpsFinding = {
  id: string;
  organisation_id: string;
  finding_key: string;
  severity: string;
  what_happened: string;
  evidence: string;
  period_start: string | null;
  period_end: string | null;
  magnitude: string | null;
  why_it_matters: string;
  possible_causes: string;
  confidence: string;
  recommended_action: string;
  suggested_owner_id: string | null;
  hayden_required: number;
  task_id: string | null;
  status: string;
};

export function refreshFindings(db: Database.Database, organisationId: string, rows: AppointmentRow[], period?: { start: string; end: string }) {
  const noShows = unattendedNoShows(db, organisationId);
  if (noShows.length) {
    upsert(db, {
      organisationId,
      key: "unattended-no-shows",
      severity: "action",
      what: `${noShows.length} no-show${noShows.length === 1 ? "" : "s"} ha${noShows.length === 1 ? "s" : "ve"} no rebooking attempt stored.`,
      evidence: noShows.map((row) => `${row.scheduled_at ?? "undated"} · ${row.setter_name ?? "owner not stored"}`).join("\n"),
      period,
      magnitude: String(noShows.length),
      why: "A no-show with no follow-up is an open appointment, not a closed one.",
      causes: "The stored records do not say why the follow-up is missing.",
      confidence: "high",
      action: "Clean up unrecovered no-shows",
      ownerId: ownerId(db, "ap"),
      hayden: false,
    });
  }
  for (const row of attendanceConcerns(rows)) {
    upsert(db, {
      organisationId,
      key: `attendance-${row.id}`,
      severity: "watch",
      what: "A stored transcript includes an attendance concern.",
      evidence: row.attendance_evidence ?? "",
      period,
      magnitude: null,
      why: "The lead said something that may affect whether they attend. The CRM status alone is not being used as that evidence.",
      causes: "This is the stored transcript, not a guessed reason.",
      confidence: "high",
      action: "Read the transcript and decide the follow-up.",
      ownerId: ownerId(db, "nic"),
      hayden: false,
    });
  }
  const drilled = drillShowRate(rows);
  if (drilled.overall.denominator >= 8 && drilled.concentrated.length) {
    const group = drilled.concentrated[0];
    upsert(db, {
      organisationId,
      key: `show-rate-${period?.start ?? "open"}-${period?.end ?? "open"}`,
      severity: "action",
      what: `Show rate is ${Math.round((drilled.overall.rate ?? 0) * 100)}% (${drilled.overall.sat}/${drilled.overall.denominator}).`,
      evidence: `${group.name}: ${group.sat}/${group.denominator}.`,
      period,
      magnitude: `${group.sat}/${group.denominator}`,
      why: "The lower rate is concentrated in a stored group, not spread evenly.",
      causes: `Supported by the stored split: ${group.name}. Other causes are not in the data.`,
      confidence: "medium",
      action: "Check confirmation and booking delay for that group.",
      ownerId: ownerId(db, "nic"),
      hayden: false,
    });
  }
  hygiene(db, organisationId);
}

export function listOpsFindings(db: Database.Database, organisationId?: string) {
  if (organisationId) return db.prepare(`SELECT * FROM ops_findings WHERE organisation_id = ? AND status = 'open' ORDER BY created_at DESC`).all(organisationId) as OpsFinding[];
  return db.prepare(`SELECT * FROM ops_findings WHERE status = 'open' ORDER BY created_at DESC`).all() as OpsFinding[];
}

export function createWorkFromFinding(db: Database.Database, findingId: string) {
  const finding = db.prepare(`SELECT * FROM ops_findings WHERE id = ?`).get(findingId) as OpsFinding | undefined;
  if (!finding) throw new Error("That finding is not stored.");
  if (finding.task_id) return finding.task_id;
  const now = new Date().toISOString();
  const taskId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO tasks (
      id, organisation_id, title, description, owner_id, priority, status, requires_hayden, recommended_action, why_it_matters, source, created_at
    ) VALUES (?, ?, ?, ?, ?, 'normal', 'open', ?, ?, ?, 'operations', ?)`,
  ).run(
    taskId,
    finding.organisation_id,
    finding.recommended_action,
    finding.evidence,
    finding.suggested_owner_id,
    finding.hayden_required,
    finding.recommended_action,
    finding.why_it_matters,
    now,
  );
  db.prepare(`UPDATE ops_findings SET task_id = ? WHERE id = ?`).run(taskId, findingId);
  return taskId;
}

function hygiene(db: Database.Database, organisationId: string) {
  const bookedWithoutAppointment = db
    .prepare(
      `SELECT l.id, l.name, l.phone FROM ops_leads l
       WHERE l.organisation_id = ? AND l.stage = 'booked'
         AND NOT EXISTS (SELECT 1 FROM ops_appointments a WHERE a.lead_id = l.id)`,
    )
    .all(organisationId) as Array<{ id: string; name: string | null; phone: string | null }>;
  if (bookedWithoutAppointment.length) {
    upsert(db, {
      organisationId,
      key: "booked-without-appointment",
      severity: "action",
      what: `${bookedWithoutAppointment.length} lead${bookedWithoutAppointment.length === 1 ? "" : "s"} marked booked ha${bookedWithoutAppointment.length === 1 ? "s" : "ve"} no appointment stored.`,
      evidence: bookedWithoutAppointment.map((row) => row.name || row.phone || row.id).join("\n"),
      why: "The pipeline stage and the appointment record disagree.",
      causes: "This is a data mismatch. The cause of the mismatch is not stored.",
      confidence: "high",
      action: "Clean up leads marked booked with no appointment.",
      ownerId: ownerId(db, "ap"),
      hayden: false,
    });
  }
  const phones = db.prepare(`SELECT phone, COUNT(*) AS n FROM ops_leads WHERE organisation_id = ? AND phone IS NOT NULL GROUP BY phone HAVING n > 1`).all(organisationId) as Array<{ phone: string; n: number }>;
  if (phones.length) {
    upsert(db, {
      organisationId,
      key: "duplicate-phones",
      severity: "watch",
      what: `${phones.length} phone number${phones.length === 1 ? "" : "s"} appear on more than one lead.`,
      evidence: phones.map((row) => `${row.phone} · ${row.n}`).join("\n"),
      why: "Duplicate leads can split follow-up.",
      causes: "The records share a phone number. That is the evidence. It is not proof they are the same person in every case.",
      confidence: "medium",
      action: "Review duplicate phone numbers.",
      ownerId: ownerId(db, "ap"),
      hayden: false,
    });
  }
}

function ownerId(db: Database.Database, id: "ap" | "nic") {
  return personRecord(db, id) ? id : null;
}

export function saveOpsFinding(
  db: Database.Database,
  input: {
    organisationId: string;
    key: string;
    severity: string;
    what: string;
    evidence: string;
    why: string;
    causes: string;
    confidence: string;
    action: string;
    ownerId: string | null;
    hayden: boolean;
  },
) {
  return upsert(db, input);
}

function upsert(
  db: Database.Database,
  input: {
    organisationId: string;
    key: string;
    severity: string;
    what: string;
    evidence: string;
    period?: { start: string; end: string };
    magnitude?: string | null;
    why: string;
    causes: string;
    confidence: string;
    action: string;
    ownerId: string | null;
    hayden: boolean;
  },
) {
  const existing = db.prepare(`SELECT id FROM ops_findings WHERE organisation_id = ? AND finding_key = ? AND status = 'open'`).get(input.organisationId, input.key) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ops_findings (
      id, organisation_id, finding_key, severity, what_happened, evidence, period_start, period_end, magnitude,
      why_it_matters, possible_causes, confidence, recommended_action, suggested_owner_id, hayden_required, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).run(
    id,
    input.organisationId,
    input.key,
    input.severity,
    input.what,
    input.evidence,
    input.period?.start ?? null,
    input.period?.end ?? null,
    input.magnitude ?? null,
    input.why,
    input.causes,
    input.confidence,
    input.action,
    input.ownerId,
    input.hayden ? 1 : 0,
    new Date().toISOString(),
  );
  return id;
}

export function showRateText(rows: AppointmentRow[]) {
  const rate = showRate(rows);
  return rate;
}
