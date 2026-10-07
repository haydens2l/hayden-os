import type Database from "better-sqlite3";
import { daySpan, shiftDay } from "@/lib/ops/csv";
import { definitionFor, targetFor } from "@/lib/ops/kpis";

export type AppointmentRow = {
  id: string;
  setter_name: string | null;
  scheduled_at: string | null;
  status: string;
  booking_delay_days: number | null;
  confirmation_recorded: number | null;
  partner_uncertain: number | null;
  reschedule_requested: number | null;
  attendance_evidence: string | null;
  evidence_type: string | null;
  rebooking_attempted: number | null;
  rebooked_at: string | null;
  lead_id: string | null;
  import_id: string | null;
  campaign_name: string | null;
  pipeline_stage: string | null;
  tags: string | null;
};

const EXPECTED = new Set(["sat", "no_show", "cancelled"]);
const MEANINGFUL_POINTS = 10;
const MIN_SAMPLE = 8;

export function appointmentsIn(db: Database.Database, organisationId: string, start?: string, end?: string) {
  const rows = db.prepare(`SELECT * FROM ops_appointments WHERE organisation_id = ?`).all(organisationId) as AppointmentRow[];
  return rows.filter((row) => {
    if (!row.scheduled_at) return false;
    if (start && row.scheduled_at < start) return false;
    if (end && row.scheduled_at > end) return false;
    return true;
  });
}

export function showRate(rows: AppointmentRow[]) {
  const expected = rows.filter((row) => EXPECTED.has(row.status));
  const sat = expected.filter((row) => row.status === "sat").length;
  const denominator = expected.length;
  return {
    sat,
    denominator,
    rate: denominator === 0 ? null : sat / denominator,
    formula: "appointments sat / appointments expected to occur",
    denominatorMeaning: "sat, no-show, and cancelled in the period",
  };
}

export function rateText(rate: { sat: number; denominator: number; rate: number | null }) {
  if (rate.rate === null) return "No appointments expected to occur are stored for that period.";
  return `${percent(rate.rate)} (${rate.sat}/${rate.denominator})`;
}

export function compareShowRate(current: AppointmentRow[], previous: AppointmentRow[]) {
  const now = showRate(current);
  const before = showRate(previous);
  const points = now.rate !== null && before.rate !== null ? (now.rate - before.rate) * 100 : null;
  const meaningful = points !== null && Math.abs(points) >= MEANINGFUL_POINTS && now.denominator >= MIN_SAMPLE && before.denominator >= MIN_SAMPLE;
  return { now, before, points, meaningful };
}

export function previousPeriod(start: string, end: string) {
  const days = daySpan(start, end) + 1;
  const previousEnd = shiftDay(start, -1);
  return { start: shiftDay(previousEnd, -(days - 1)), end: previousEnd };
}

export function drillShowRate(rows: AppointmentRow[]) {
  const overall = showRate(rows);
  const setters = groupRate(rows, (row) => row.setter_name || "Setter not stored");
  const delays = groupRate(rows, (row) => delayBucket(row.booking_delay_days));
  const concentrated = [...setters, ...delays].filter((group) => {
    if (overall.rate === null || group.rate === null || group.denominator < 5) return false;
    return (overall.rate - group.rate) * 100 >= 15;
  });
  return { overall, setters, delays, concentrated };
}

export function setterBoard(db: Database.Database, organisationId: string, start?: string, end?: string) {
  const rows = appointmentsIn(db, organisationId, start, end);
  const names = [...new Set(rows.map((row) => row.setter_name || "Setter not stored"))];
  const dials = db.prepare(`SELECT actor_name, COUNT(*) AS n FROM ops_activities WHERE organisation_id = ? AND kind = 'dial' GROUP BY actor_name`).all(organisationId) as Array<{ actor_name: string | null; n: number }>;
  return names.map((name) => {
    const mine = rows.filter((row) => (row.setter_name || "Setter not stored") === name);
    const rate = showRate(mine);
    const target = targetFor(db, organisationId, "show_rate", name);
    const dial = dials.find((row) => row.actor_name === name);
    return {
      name,
      booked: mine.length,
      sat: rate.sat,
      expected: rate.denominator,
      showRate: rate.rate,
      noShows: mine.filter((row) => row.status === "no_show").length,
      cancelled: mine.filter((row) => row.status === "cancelled").length,
      rescheduled: mine.filter((row) => row.status === "rescheduled").length,
      dials: dial ? dial.n : null,
      target: target ? target.target_value : null,
      belowTarget: target && rate.rate !== null ? rate.rate * 100 < target.target_value : null,
    };
  });
}

export function unattendedNoShows(db: Database.Database, organisationId: string) {
  return (db.prepare(`SELECT * FROM ops_appointments WHERE organisation_id = ? AND status = 'no_show' AND COALESCE(rebooking_attempted, 0) = 0`).all(organisationId) as AppointmentRow[]);
}

export function attendanceConcerns(rows: AppointmentRow[]) {
  return rows.filter((row) => row.evidence_type === "transcript" && /might not|may not|not sure|can'?t make|cannot make|won'?t make/i.test(row.attendance_evidence || ""));
}

export function riskSignals(row: AppointmentRow, previousNoShow: boolean) {
  const signals: string[] = [];
  if (row.evidence_type === "transcript" && row.attendance_evidence?.trim()) signals.push(`Transcript: ${row.attendance_evidence.trim()}`);
  if (row.partner_uncertain === 1) signals.push("Partner availability uncertain");
  if (row.reschedule_requested === 1 || row.status === "rescheduled") signals.push("Reschedule requested");
  if ((row.booking_delay_days ?? 0) >= 7) signals.push(`Booked ${row.booking_delay_days} days ahead`);
  if (row.confirmation_recorded === 0) signals.push("No confirmation recorded");
  if (previousNoShow) signals.push("A previous no-show is stored for this lead");
  return signals;
}

export function bringForward(rows: AppointmentRow[]) {
  return rows.filter((row) => row.status === "booked" && /any afternoon|earlier|sooner|bring forward/i.test(row.attendance_evidence || ""));
}

export function dataQuality(db: Database.Database, organisationId: string, asOf: string) {
  const appointments = db.prepare(`SELECT COUNT(*) AS n, MAX(scheduled_at) AS latest FROM ops_appointments WHERE organisation_id = ?`).get(organisationId) as { n: number; latest: string | null };
  const calls = db.prepare(`SELECT COUNT(*) AS n, MAX(occurred_at) AS latest FROM ops_activities WHERE organisation_id = ? AND kind = 'dial'`).get(organisationId) as { n: number; latest: string | null };
  const sales = db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN revenue IS NULL THEN 1 ELSE 0 END) AS missing_revenue FROM ops_outcomes WHERE organisation_id = ? AND kind = 'sale'`).get(organisationId) as { n: number; missing_revenue: number };
  const stale = (latest: string | null) => !latest || daySpan(latest.slice(0, 10), asOf) > 14;
  return [
    dataset("Appointments", appointments.n, appointments.latest, stale(appointments.latest), false),
    dataset("Calls", calls.n, calls.latest, stale(calls.latest), false),
    dataset("Sales", sales.n, null, false, sales.n > 0 && sales.missing_revenue > 0),
    { name: "Revenue", state: sales.n === 0 || sales.missing_revenue === sales.n ? "missing" : sales.missing_revenue > 0 ? "partial" : "complete", detail: sales.n === 0 ? "No sale revenue is stored." : sales.missing_revenue > 0 ? "Some sales have no revenue." : "Revenue is stored on the sales." },
  ];
}

export function scorecard(db: Database.Database, organisationId: string, start: string, end: string) {
  const confirmed = definitionFor(db, organisationId, "show_rate");
  const current = appointmentsIn(db, organisationId, start, end);
  const previousWindow = previousPeriod(start, end);
  const previous = appointmentsIn(db, organisationId, previousWindow.start, previousWindow.end);
  const comparison = compareShowRate(current, previous);
  const target = targetFor(db, organisationId, "show_rate");
  const source = db.prepare(`SELECT source_name, period_start, period_end FROM ops_imports WHERE organisation_id = ? ORDER BY imported_at DESC LIMIT 1`).get(organisationId) as { source_name: string; period_start: string | null; period_end: string | null } | undefined;
  const actual = confirmed?.status === "confirmed" ? comparison.now.rate : null;
  const variance = actual !== null && target ? actual * 100 - target.target_value : null;
  return {
    confirmed: confirmed?.status === "confirmed",
    formula: confirmed?.formula ?? "appointments sat / appointments expected to occur",
    counts: comparison.now,
    previous: comparison.before,
    points: comparison.points,
    meaningful: comparison.meaningful,
    target,
    variance,
    period: `${start} to ${end}`,
    source: source ? `${source.source_name}${source.period_start ? ` · ${source.period_start} to ${source.period_end}` : ""}` : "No import is stored",
    sat: current.filter((row) => row.status === "sat").length,
    booked: current.length,
  };
}

function dataset(name: string, count: number, latest: string | null, stale: boolean, partial: boolean) {
  if (count === 0) return { name, state: "missing" as const, detail: `No ${name.toLowerCase()} are stored.` };
  if (partial) return { name, state: "partial" as const, detail: `${name} are stored, with gaps.` };
  if (stale) return { name, state: "stale" as const, detail: `${name} stop at ${latest}.` };
  return { name, state: "complete" as const, detail: `${name} run through ${latest}.` };
}

function groupRate(rows: AppointmentRow[], label: (row: AppointmentRow) => string) {
  const groups = new Map<string, AppointmentRow[]>();
  for (const row of rows) {
    const key = label(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([name, items]) => ({ name, ...showRate(items) }));
}

function delayBucket(days: number | null) {
  if (days === null) return "Delay not stored";
  if (days <= 2) return "0–2 days";
  if (days <= 5) return "3–5 days";
  return "6+ days";
}

export function percent(rate: number) {
  return `${Math.round(rate * 1000) / 10}%`;
}
