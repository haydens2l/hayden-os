import type Database from "better-sqlite3";
import { saveOpsFinding } from "@/lib/ops/findings";
import { rebuildNoShows } from "@/lib/ops/noshow";
import { personRecord } from "@/lib/work/people";

export function freshness(db: Database.Database) {
  const connections = db.prepare(`SELECT id, last_sync_at, last_summary, status FROM ops_connections`).all() as Array<{ id: string; last_sync_at: string | null; last_summary: string | null; status: string }>;
  const transcripts = db.prepare(`SELECT status, COUNT(*) AS n FROM ops_transcripts GROUP BY status`).all() as Array<{ status: string; n: number }>;
  const answered = db.prepare(`SELECT COUNT(*) AS n FROM ops_activities WHERE external_source = 'aircall' AND outcome LIKE '%answered%'`).get() as { n: number };
  const available = transcripts.find((row) => row.status === "available")?.n ?? 0;
  const missing = transcripts.find((row) => row.status === "missing")?.n ?? 0;
  return {
    connections,
    transcriptsAvailable: available,
    transcriptsMissing: missing,
    transcriptsUnchecked: Math.max(0, answered.n - available - missing),
  };
}

export function leadTimeline(db: Database.Database, leadId: string) {
  const lead = db.prepare(`SELECT * FROM ops_leads WHERE id = ?`).get(leadId) as Record<string, string | null> | undefined;
  if (!lead) return [];
  const events: Array<{ at: string; label: string; source: string }> = [];
  if (lead.created_at) events.push({ at: lead.created_at, label: `Entered ${lead.source_name || "GoHighLevel"}${lead.stage ? ` · ${lead.stage}` : ""}`, source: "GoHighLevel" });
  const calls = db.prepare(`SELECT occurred_at, actor_name, outcome, duration_seconds, external_id FROM ops_activities WHERE lead_id = ? OR person_id = ? ORDER BY occurred_at`).all(leadId, lead.person_id) as Array<{ occurred_at: string | null; actor_name: string | null; outcome: string | null; duration_seconds: number | null; external_id: string }>;
  for (const call of calls) {
    if (!call.occurred_at) continue;
    const minutes = call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s` : "duration not stored";
    events.push({ at: call.occurred_at, label: `${call.actor_name || "Caller"} · ${call.outcome || "call"} · ${minutes}`, source: "Aircall" });
    const transcript = db.prepare(`SELECT status FROM ops_transcripts WHERE call_external_id = ?`).get(call.external_id) as { status: string } | undefined;
    if (transcript?.status === "available") events.push({ at: call.occurred_at, label: "Transcript available", source: "Aircall" });
  }
  const appointments = db.prepare(`SELECT scheduled_at, booked_at, status, setter_name, campaign_name FROM ops_appointments WHERE lead_id = ?`).all(leadId) as Array<{ scheduled_at: string | null; booked_at: string | null; status: string; setter_name: string | null; campaign_name: string | null }>;
  for (const appointment of appointments) {
    if (appointment.booked_at) events.push({ at: appointment.booked_at, label: `Appointment created · ${appointment.status}`, source: "GoHighLevel" });
    if (appointment.scheduled_at) events.push({ at: appointment.scheduled_at, label: `Appointment ${appointment.scheduled_at} · ${appointment.campaign_name || "calendar"} · ${appointment.setter_name || "owner not stored"}`, source: "GoHighLevel" });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

export function appointmentWatch(db: Database.Database) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(
    `SELECT a.id, a.scheduled_at, a.booked_at, a.status, a.setter_name, a.campaign_name, a.confirmation_recorded, a.booking_delay_days, a.lead_id, l.name, l.organisation_id
     FROM ops_appointments a
     LEFT JOIN ops_leads l ON l.id = a.lead_id
     WHERE a.scheduled_at >= ? AND a.status = 'booked'
     ORDER BY a.scheduled_at
     LIMIT 40`,
  ).all(today) as Array<Record<string, string | number | null>>;
  return rows.map((row) => {
    const signals = db.prepare(`SELECT signal_type, evidence, speaker FROM ops_signals WHERE appointment_id = ?`).all(row.id) as Array<{ signal_type: string; evidence: string; speaker: string | null }>;
    const previousNoShow = row.lead_id
      ? (db.prepare(`SELECT COUNT(*) AS n FROM ops_appointments WHERE lead_id = ? AND status = 'no_show' AND id != ?`).get(row.lead_id, row.id) as { n: number }).n
      : 0;
    const attention = attentionFor(signals, Number(row.confirmation_recorded ?? 0), Number(row.booking_delay_days ?? 0), previousNoShow);
    return { ...row, signals, attention };
  }).filter((row) => row.attention.length);
}

function attentionFor(signals: Array<{ signal_type: string }>, confirmed: number, delay: number, previousNoShow: number) {
  const items: Array<{ label: string; action: string }> = [];
  if (signals.some((signal) => signal.signal_type === "PARTNER_ATTENDANCE_CONCERN")) items.push({ label: "Partner attendance uncertain", action: "Confirm partner" });
  if (signals.some((signal) => signal.signal_type === "LEAD_ATTENDANCE_CONCERN")) items.push({ label: "Lead said the date may not work", action: "Call lead" });
  if (signals.some((signal) => signal.signal_type === "BOTH_ATTENDANCE_CONCERN")) items.push({ label: "Both people may not attend", action: "Confirm both" });
  if (signals.some((signal) => signal.signal_type === "RESCHEDULE_REQUEST" || signal.signal_type === "TIMING_UNCERTAINTY")) items.push({ label: "The time is uncertain", action: "Call lead" });
  if (signals.some((signal) => signal.signal_type === "BRING_FORWARD_FLEXIBILITY")) items.push({ label: "Lead indicated earlier flexibility", action: "Consider bringing forward" });
  if (delay >= 7) items.push({ label: `Booked ${delay} days ahead`, action: "No action" });
  if (!confirmed) items.push({ label: "Confirmation is not recorded", action: "Call lead" });
  if (previousNoShow) items.push({ label: "A previous no-show is stored", action: "Call lead" });
  return items;
}

export function bringForwardSignals(db: Database.Database) {
  return db.prepare(
    `SELECT s.evidence, s.speaker, s.occurred_at, s.call_external_id, l.name, l.id AS lead_id, a.scheduled_at
     FROM ops_signals s
     LEFT JOIN ops_leads l ON l.id = s.lead_id
     LEFT JOIN ops_appointments a ON a.id = s.appointment_id
     WHERE s.signal_type = 'BRING_FORWARD_FLEXIBILITY'
       AND a.scheduled_at >= date('now')
     ORDER BY s.occurred_at DESC`,
  ).all() as Array<{ evidence: string; speaker: string | null; occurred_at: string | null; call_external_id: string; name: string | null; lead_id: string | null; scheduled_at: string | null }>;
}

export function noShowRecovery(db: Database.Database) {
  const fromAppointments = db.prepare(
    `SELECT l.id AS lead_id, l.name, l.organisation_id, a.scheduled_at AS marker, 'appointment' AS kind
     FROM ops_appointments a JOIN ops_leads l ON l.id = a.lead_id
     WHERE a.status = 'no_show'`,
  ).all() as RecoveryRow[];
  const fromStages = db.prepare(
    `SELECT id AS lead_id, name, organisation_id, stage_changed_at AS marker, 'stage' AS kind
     FROM ops_leads
     WHERE external_source = 'gohighlevel' AND lower(stage) LIKE '%no show%'`,
  ).all() as RecoveryRow[];
  const seen = new Set(fromAppointments.map((row) => row.lead_id));
  const rows = [...fromAppointments, ...fromStages.filter((row) => !seen.has(row.lead_id))];
  return rows.map((row) => {
    const calls = row.marker
      ? (db.prepare(`SELECT COUNT(*) AS n, MAX(occurred_at) AS latest FROM ops_activities WHERE lead_id = ? AND occurred_at > ?`).get(row.lead_id, row.marker) as { n: number; latest: string | null })
      : { n: 0, latest: null };
    const rebooked = (db.prepare(`SELECT COUNT(*) AS n FROM ops_appointments WHERE lead_id = ? AND status = 'booked' AND scheduled_at > COALESCE(?, '')`).get(row.lead_id, row.marker) as { n: number }).n;
    return { ...row, calls: calls.n, latest: calls.latest, rebooked: rebooked > 0 };
  }).filter((row) => row.calls === 0 && !row.rebooked);
}

type RecoveryRow = { lead_id: string; name: string | null; organisation_id: string; marker: string | null; kind: string };

export function setterActivity(db: Database.Database, span?: { start: string; end: string } | null) {
  const dated = Boolean(span);
  return db.prepare(
    `SELECT actor_name AS name,
            COUNT(*) AS calls,
            SUM(CASE WHEN outcome LIKE '%answered%' THEN 1 ELSE 0 END) AS connected,
            SUM(duration_seconds) AS talk_seconds,
            MIN(occurred_at) AS first_at,
            MAX(occurred_at) AS last_at
     FROM ops_activities
     WHERE external_source = 'aircall' AND actor_name IS NOT NULL
       ${dated ? "AND occurred_at >= ? AND occurred_at < ?" : ""}
     GROUP BY actor_name
     ORDER BY calls DESC
     LIMIT 12`,
  ).all(...(span ? [span.start, span.end] : [])) as Array<{ name: string; calls: number; connected: number; talk_seconds: number | null; first_at: string | null; last_at: string | null }>;
}

export function setterCallRows(db: Database.Database, span: { start: string; end: string }, nameIncludes = "") {
  const named = nameIncludes.trim().length > 0;
  return db.prepare(
    `SELECT occurred_at AS at,
            CASE WHEN outcome LIKE '%answered%' THEN 1 ELSE 0 END AS answered
     FROM ops_activities
     WHERE external_source = 'aircall' AND actor_name IS NOT NULL
       AND occurred_at >= ? AND occurred_at < ?
       ${named ? "AND actor_name LIKE ? COLLATE NOCASE" : ""}
     ORDER BY occurred_at`,
  ).all(...(named ? [span.start, span.end, `%${nameIncludes}%`] : [span.start, span.end])) as Array<{ at: string; answered: number }>;
}

export function setterAppointments(db: Database.Database) {
  return db.prepare(
    `SELECT COALESCE(setter_name, 'Owner not stored') AS name,
            SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END) AS booked,
            SUM(CASE WHEN status = 'sat' THEN 1 ELSE 0 END) AS sat,
            SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS no_show,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
     FROM ops_appointments
     GROUP BY setter_name
     ORDER BY booked DESC`,
  ).all() as Array<{ name: string; booked: number; sat: number; no_show: number; cancelled: number }>;
}

export function pipelineIssues(db: Database.Database) {
  const booked = db.prepare(
    `SELECT COUNT(*) AS n FROM ops_leads l
     WHERE external_source = 'gohighlevel' AND lower(l.stage) LIKE '%booked%'
       AND NOT EXISTS (SELECT 1 FROM ops_appointments a WHERE a.lead_id = l.id)`,
  ).get() as { n: number };
  const noShowStage = db.prepare(`SELECT COUNT(*) AS n FROM ops_leads WHERE external_source = 'gohighlevel' AND lower(stage) LIKE '%no show%'`).get() as { n: number };
  const duplicates = db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT contact_external_id FROM ops_leads
       WHERE external_source = 'gohighlevel' AND contact_external_id IS NOT NULL
       GROUP BY contact_external_id HAVING COUNT(*) > 1
     )`,
  ).get() as { n: number };
  return { bookedWithoutAppointment: booked.n, noShowStage: noShowStage.n, duplicateContacts: duplicates.n };
}

export function joshAudit(db: Database.Database) {
  const rows = db.prepare(
    `SELECT s.signal_type, s.evidence, s.speaker, s.occurred_at, s.call_external_id, l.name, l.id AS lead_id, a.scheduled_at, act.actor_name
     FROM ops_signals s
     LEFT JOIN ops_leads l ON l.id = s.lead_id
     LEFT JOIN ops_appointments a ON a.id = s.appointment_id
     LEFT JOIN ops_activities act ON act.external_source = 'aircall' AND act.external_id = s.call_external_id
     WHERE act.actor_name LIKE '%Josh%'
       AND s.signal_type IN ('attendance concern', 'partner attendance concern', 'bring-forward')
     ORDER BY s.occurred_at DESC`,
  ).all() as Array<{ signal_type: string; evidence: string; speaker: string | null; occurred_at: string | null; call_external_id: string; name: string | null; lead_id: string | null; scheduled_at: string | null; actor_name: string | null }>;
  return rows.map((row) => ({ ...row, action: actionFor(row.signal_type) }));
}

function actionFor(signal: string) {
  if (signal === "partner attendance concern") return "Confirm the partner can attend.";
  if (signal === "bring-forward") return "Ask if an earlier time would help. An earlier slot is not confirmed.";
  return "Call and check whether the appointment still stands.";
}

export function recordRecoveryFinding(db: Database.Database) {
  rebuildNoShows(db);
  const row = db.prepare(`SELECT id FROM ops_findings WHERE finding_key = 'no-show-recovery-gap' AND status = 'open'`).get() as { id: string } | undefined;
  return row?.id ?? null;
}

export function recordPipelineFinding(db: Database.Database) {
  const issues = pipelineIssues(db);
  if (!issues.bookedWithoutAppointment) return null;
  const owner = personRecord(db, "ap") ? "ap" : null;
  return saveOpsFinding(db, {
    organisationId: "fifo",
    key: "booked-stage-without-appointment",
    severity: "watch",
    what: `${issues.bookedWithoutAppointment} leads are in a booked stage and have no appointment stored.`,
    evidence: "Compared GoHighLevel stage text with stored appointments. Names are not copied into this finding.",
    why: "The stage and the calendar can disagree.",
    causes: "Either the appointment was not returned by the calendar pull, or the stage was set without a calendar event.",
    confidence: "medium",
    action: "Check booked stages that have no appointment.",
    ownerId: owner,
    hayden: false,
  });
}

export function followUpRule(db: Database.Database) {
  const rows = db.prepare(`SELECT title, content FROM knowledge`).all() as Array<{ title: string; content: string }>;
  return rows.find((row) => /\d+\s+attempts?/i.test(`${row.title} ${row.content}`) && /follow/i.test(`${row.title} ${row.content}`)) ?? null;
}
