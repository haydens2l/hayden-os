import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { storedOrFetchTranscript } from "@/lib/integrations/aircall/transcripts";
import { brisbaneToday } from "@/lib/dates";
import { signalAction, signalsFromUtterances } from "@/lib/ops/signals";

export type AppointmentTiming = "UPCOMING" | "TODAY" | "PAST" | "CANCELLED" | "UNKNOWN";

export type BookingSignal = {
  signalType: string;
  evidence: string;
  speaker: string | null;
  callId: string;
  occurredAt: string | null;
  lead: string | null;
  leadId: string | null;
  appointmentAt: string | null;
  bookedAt: string | null;
  action: string;
  timing: AppointmentTiming;
};

export type BookingReport = {
  bookings: number;
  conversations: number;
  transcripts: number;
  analysed: number;
  unable: number;
  coverage: string;
  lead: BookingSignal[];
  partner: BookingSignal[];
  both: BookingSignal[];
  reschedule: BookingSignal[];
  bringForward: BookingSignal[];
  historical: BookingSignal[];
  unableRows: Array<{ lead: string | null; leadId: string | null; bookedAt: string | null; reason: string | null }>;
};

export function appointmentTiming(status: string | null, scheduledAt: string | null, today = brisbaneToday()): AppointmentTiming {
  if ((status ?? "").toLowerCase() === "cancelled") return "CANCELLED";
  if (!scheduledAt) return "UNKNOWN";
  const day = scheduledAt.slice(0, 10);
  if (day > today) return "UPCOMING";
  if (day === today) return "TODAY";
  if (day < today) return "PAST";
  return "UNKNOWN";
}

function windowFor(bookedAt: string) {
  const timeUnknown = bookedAt.length <= 10;
  const basis = Date.parse(timeUnknown ? `${bookedAt}T00:00:00+10:00` : bookedAt);
  if (Number.isNaN(basis)) return null;
  const start = new Date(basis - (timeUnknown ? 48 : 72) * 3600000).toISOString();
  const end = new Date(basis + (timeUnknown ? 36 : 3) * 3600000).toISOString();
  return { start, end };
}

function fingerprint(utterances: Array<{ text: string }>) {
  return createHash("sha256").update(utterances.map((item) => item.text).join("\n")).digest("hex").slice(0, 16);
}

export async function reviewJoshBookings(db: Database.Database) {
  const since = brisbaneToday(-7);
  const appointments = db.prepare(
    `SELECT a.id, a.lead_id, a.person_id, a.booked_at, a.scheduled_at, a.status, a.organisation_id, l.name, l.person_id AS lead_person
     FROM ops_appointments a
     LEFT JOIN ops_leads l ON l.id = a.lead_id
     WHERE a.external_source = 'gohighlevel' AND COALESCE(a.booked_at, a.scheduled_at) >= ?`,
  ).all(since) as Array<{ id: string; lead_id: string | null; person_id: string | null; booked_at: string | null; scheduled_at: string | null; status: string; organisation_id: string; name: string | null; lead_person: string | null }>;
  let transcriptsDiscovered = 0;
  for (const appointment of appointments) {
    const personId = appointment.person_id || appointment.lead_person;
    const bookedAt = appointment.booked_at || appointment.scheduled_at;
    if (!personId || !bookedAt) continue;
    const span = windowFor(bookedAt);
    if (!span) continue;
    const calls = db.prepare(
      `SELECT external_id, organisation_id, lead_id, actor_name, occurred_at, outcome
       FROM ops_activities
       WHERE external_source = 'aircall' AND person_id = ? AND actor_name LIKE '%Josh%'
         AND occurred_at >= ? AND occurred_at <= ?
       ORDER BY occurred_at DESC
       LIMIT 4`,
    ).all(personId, span.start, span.end) as Array<{ external_id: string; organisation_id: string; lead_id: string | null; actor_name: string | null; occurred_at: string | null; outcome: string | null }>;
    if (!calls.length) continue;
    const existing = db.prepare(`SELECT analysis_status, transcript_fingerprint FROM ops_booking_reviews WHERE appointment_id = ?`).get(appointment.id) as { analysis_status: string; transcript_fingerprint: string | null } | undefined;
    const answered = calls.filter((call) => (call.outcome ?? "").includes("answered"));
    const loaded: Array<{ call: (typeof calls)[number]; utterances: Array<{ speaker: string; text: string }> }> = [];
    let failed = 0;
    for (const call of answered) {
      const transcript = await storedOrFetchTranscript(db, call);
      if (transcript.status === "available") loaded.push({ call, utterances: transcript.utterances });
      else if (transcript.status !== "missing") failed += 1;
    }
    const digest = loaded.length ? fingerprint(loaded.flatMap((item) => item.utterances)) : null;
    const reused = existing?.analysis_status === "ANALYSED" && digest && existing.transcript_fingerprint === digest;
    if (!reused && loaded.length) {
      const now = new Date().toISOString();
      const insert = db.prepare(
        `INSERT INTO ops_signals (id, organisation_id, lead_id, call_external_id, signal_type, speaker, evidence, occurred_at, confidence, appointment_id, analysed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of loaded) {
        db.prepare(`DELETE FROM ops_signals WHERE call_external_id = ?`).run(item.call.external_id);
        for (const signal of signalsFromUtterances(item.utterances)) {
          insert.run(crypto.randomUUID(), appointment.organisation_id, appointment.lead_id, item.call.external_id, signal.signalType, signal.speaker, signal.evidence, item.call.occurred_at, signal.confidence, appointment.id, now);
        }
        transcriptsDiscovered += 1;
      }
    }
    const status = loaded.length ? "ANALYSED" : failed ? "RETRY" : "NOT_AVAILABLE";
    const reason = status === "ANALYSED" ? null : failed ? "The transcript request failed." : "Aircall has no transcript for the booking call.";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO ops_booking_reviews (id, appointment_id, lead_id, person_id, booked_at, call_ids, analysis_status, transcript_fingerprint, analysed_at, unable_reason, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(appointment_id) DO UPDATE SET
         call_ids = excluded.call_ids,
         analysis_status = excluded.analysis_status,
         transcript_fingerprint = excluded.transcript_fingerprint,
         analysed_at = excluded.analysed_at,
         unable_reason = excluded.unable_reason,
         updated_at = excluded.updated_at`,
    ).run(crypto.randomUUID(), appointment.id, appointment.lead_id, personId, bookedAt, JSON.stringify(calls.map((call) => call.external_id)), status, digest, status === "ANALYSED" ? now : null, reason, now);
  }
  return transcriptsDiscovered;
}

function current(timing: AppointmentTiming) {
  return timing === "UPCOMING" || timing === "TODAY";
}

export function joshBookingReport(db: Database.Database, today = brisbaneToday(), since = brisbaneToday(-7)): BookingReport {
  const reviews = db.prepare(
    `SELECT r.analysis_status, r.unable_reason, r.call_ids, r.booked_at, r.lead_id, l.name, a.scheduled_at, a.status
     FROM ops_booking_reviews r
     LEFT JOIN ops_leads l ON l.id = r.lead_id
     LEFT JOIN ops_appointments a ON a.id = r.appointment_id
     WHERE r.booked_at >= ?`,
  ).all(since) as Array<{ analysis_status: string; unable_reason: string | null; call_ids: string; booked_at: string | null; lead_id: string | null; name: string | null; scheduled_at: string | null; status: string | null }>;
  const signals = db.prepare(
    `SELECT s.signal_type, s.evidence, s.speaker, s.call_external_id, s.occurred_at, s.lead_id, l.name, a.scheduled_at, a.booked_at, a.status
     FROM ops_signals s
     JOIN ops_booking_reviews r ON r.appointment_id = s.appointment_id
     LEFT JOIN ops_leads l ON l.id = s.lead_id
     LEFT JOIN ops_appointments a ON a.id = s.appointment_id
     WHERE r.booked_at >= ? AND s.signal_type IN (
       'LEAD_ATTENDANCE_CONCERN', 'PARTNER_ATTENDANCE_CONCERN', 'BOTH_ATTENDANCE_CONCERN',
       'RESCHEDULE_REQUEST', 'TIMING_UNCERTAINTY', 'BRING_FORWARD_FLEXIBILITY'
     )`,
  ).all(since) as Array<{ signal_type: string; evidence: string; speaker: string | null; call_external_id: string; occurred_at: string | null; lead_id: string | null; name: string | null; scheduled_at: string | null; booked_at: string | null; status: string | null }>;
  const mapped = signals.map((row) => ({
    signalType: row.signal_type,
    evidence: row.evidence,
    speaker: row.speaker,
    callId: row.call_external_id,
    occurredAt: row.occurred_at,
    lead: row.name,
    leadId: row.lead_id,
    appointmentAt: row.scheduled_at,
    bookedAt: row.booked_at,
    action: signalAction(row.signal_type),
    timing: appointmentTiming(row.status, row.scheduled_at, today),
  }));
  const live = (type: string) => mapped.filter((row) => row.signalType === type && current(row.timing));
  const analysed = reviews.filter((row) => row.analysis_status === "ANALYSED").length;
  const unableRows = reviews.filter((row) => row.analysis_status === "NOT_AVAILABLE" || row.analysis_status === "FAILED" || row.analysis_status === "RETRY");
  return {
    bookings: reviews.length,
    conversations: reviews.filter((row) => row.call_ids && row.call_ids !== "[]").length,
    transcripts: reviews.filter((row) => row.analysis_status === "ANALYSED").length,
    analysed,
    unable: unableRows.length,
    coverage: reviews.length ? `${analysed} / ${reviews.length} bookings` : "0 / 0 bookings",
    lead: live("LEAD_ATTENDANCE_CONCERN"),
    partner: live("PARTNER_ATTENDANCE_CONCERN"),
    both: live("BOTH_ATTENDANCE_CONCERN"),
    reschedule: [...live("RESCHEDULE_REQUEST"), ...live("TIMING_UNCERTAINTY")],
    bringForward: live("BRING_FORWARD_FLEXIBILITY"),
    historical: mapped.filter((row) => !current(row.timing)),
    unableRows: unableRows.map((row) => ({ lead: row.name, leadId: row.lead_id, bookedAt: row.booked_at, reason: row.unable_reason })),
  };
}
