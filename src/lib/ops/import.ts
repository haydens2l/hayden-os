import type Database from "better-sqlite3";
import { parseCsv, toDay } from "@/lib/ops/csv";

export type AppointmentMapping = {
  phone?: string;
  name?: string;
  setter?: string;
  appointment_at?: string;
  booked_at?: string;
  status?: string;
  confirmation?: string;
  partner?: string;
  evidence?: string;
  evidence_type?: string;
  rebooking_attempted?: string;
  campaign?: string;
  stage?: string;
  tags?: string;
  reschedule?: string;
};

const STATUSES: Record<string, string> = {
  sat: "sat",
  showed: "sat",
  show: "sat",
  attended: "sat",
  "no show": "no_show",
  "no-show": "no_show",
  noshow: "no_show",
  cancelled: "cancelled",
  canceled: "cancelled",
  rescheduled: "rescheduled",
  booked: "booked",
  scheduled: "booked",
};

export function savedMapping(db: Database.Database, organisationId: string) {
  const row = db.prepare(`SELECT mapping FROM ops_mappings WHERE organisation_id = ? AND dataset_kind = 'appointments'`).get(organisationId) as { mapping: string } | undefined;
  return row ? (JSON.parse(row.mapping) as AppointmentMapping) : null;
}

export function saveMapping(db: Database.Database, organisationId: string, mapping: AppointmentMapping) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ops_mappings (id, organisation_id, dataset_kind, mapping, saved_at)
     VALUES (?, ?, 'appointments', ?, ?)
     ON CONFLICT(organisation_id, dataset_kind) DO UPDATE SET mapping = excluded.mapping, saved_at = excluded.saved_at`,
  ).run(crypto.randomUUID(), organisationId, JSON.stringify(mapping), now);
}

export function storeDraft(db: Database.Database, organisationId: string, fileName: string, csvText: string) {
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO ops_import_drafts (id, organisation_id, file_name, csv_text, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    organisationId,
    fileName,
    csvText,
    new Date().toISOString(),
  );
  return id;
}

export function getDraft(db: Database.Database, id: string) {
  return db.prepare(`SELECT * FROM ops_import_drafts WHERE id = ?`).get(id) as
    | { id: string; organisation_id: string; file_name: string; csv_text: string }
    | undefined;
}

export function previewAppointments(csvText: string, mapping: AppointmentMapping) {
  return assess(csvText, mapping);
}

export function importAppointments(
  db: Database.Database,
  input: { organisationId: string; fileName: string; csvText: string; mapping: AppointmentMapping; save?: boolean },
) {
  if (!input.mapping.status || !input.mapping.appointment_at) {
    throw new Error("Status and appointment date have to be mapped before anything is imported.");
  }
  const assessed = assess(input.csvText, input.mapping);
  const now = new Date().toISOString();
  const importId = crypto.randomUUID();
  const days = assessed.accepted.map((row) => row.scheduledAt).filter((day): day is string => Boolean(day)).sort();
  db.prepare(
    `INSERT INTO ops_imports (
      id, organisation_id, source_name, source_kind, imported_at, period_start, period_end, schema_mapping,
      rows_accepted, rows_rejected, validation_issues, file_name
    ) VALUES (?, ?, ?, 'csv', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    importId,
    input.organisationId,
    input.fileName,
    now,
    days[0] ?? null,
    days[days.length - 1] ?? null,
    JSON.stringify(input.mapping),
    assessed.accepted.length,
    assessed.rejected.length,
    JSON.stringify(assessed.issues),
    input.fileName,
  );
  for (const row of assessed.accepted) insertAppointment(db, input.organisationId, importId, row);
  if (input.save) saveMapping(db, input.organisationId, input.mapping);
  return { importId, accepted: assessed.accepted.length, rejected: assessed.rejected.length, issues: assessed.issues, periodStart: days[0] ?? null, periodEnd: days[days.length - 1] ?? null };
}

export function addManualAppointment(
  db: Database.Database,
  input: { organisationId: string; scheduledAt: string; status: string; setterName?: string; name?: string; phone?: string; evidence?: string; evidenceType?: string },
) {
  const day = toDay(input.scheduledAt);
  const status = normalStatus(input.status);
  if (!day || !status) throw new Error("A manual appointment needs a readable date and a known status.");
  const now = new Date().toISOString();
  const importId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ops_imports (
      id, organisation_id, source_name, source_kind, imported_at, period_start, period_end, schema_mapping,
      rows_accepted, rows_rejected, validation_issues, file_name
    ) VALUES (?, ?, 'Manual entry', 'manual', ?, ?, ?, '{}', 1, 0, '[]', NULL)`,
  ).run(importId, input.organisationId, now, day, day);
  insertAppointment(db, input.organisationId, importId, {
    scheduledAt: day,
    bookedAt: null,
    status,
    setter: input.setterName?.trim() || null,
    name: input.name?.trim() || null,
    phone: input.phone?.trim() || null,
    confirmation: null,
    partner: null,
    evidence: input.evidence?.trim() || null,
    evidenceType: input.evidenceType?.trim() || (input.evidence ? "manual" : null),
    rebooking: null,
    campaign: null,
    stage: null,
    tags: null,
    reschedule: null,
    delay: null,
  });
  return importId;
}

function assess(csvText: string, mapping: AppointmentMapping) {
  const table = parseCsv(csvText);
  const header = table[0] ?? [];
  const issues: string[] = [];
  const accepted: ReturnType<typeof readRow>[] = [];
  const rejected: number[] = [];
  if (!mapping.status || !mapping.appointment_at) {
    issues.push("Status and appointment date are not mapped.");
    return { header, accepted, rejected, issues };
  }
  table.slice(1).forEach((cells, index) => {
    const record = Object.fromEntries(header.map((name, column) => [name, cells[column] ?? ""]));
    const row = readRow(record, mapping);
    if (!row.scheduledAt || !row.status) {
      rejected.push(index + 2);
      issues.push(`Row ${index + 2} was rejected. Date or status could not be read.`);
      return;
    }
    accepted.push(row);
  });
  return { header, accepted, rejected, issues };
}

function readRow(record: Record<string, string>, mapping: AppointmentMapping) {
  const scheduledAt = toDay(value(record, mapping.appointment_at));
  const bookedAt = toDay(value(record, mapping.booked_at));
  const status = normalStatus(value(record, mapping.status));
  const delay = scheduledAt && bookedAt ? Math.round((Date.parse(`${scheduledAt}T00:00:00Z`) - Date.parse(`${bookedAt}T00:00:00Z`)) / 86400000) : null;
  return {
    scheduledAt,
    bookedAt,
    status,
    setter: clean(value(record, mapping.setter)),
    name: clean(value(record, mapping.name)),
    phone: clean(value(record, mapping.phone)),
    confirmation: flag(value(record, mapping.confirmation)),
    partner: flag(value(record, mapping.partner)),
    evidence: clean(value(record, mapping.evidence)),
    evidenceType: clean(value(record, mapping.evidence_type)),
    rebooking: flag(value(record, mapping.rebooking_attempted)),
    campaign: clean(value(record, mapping.campaign)),
    stage: clean(value(record, mapping.stage)),
    tags: clean(value(record, mapping.tags)),
    reschedule: flag(value(record, mapping.reschedule)),
    delay,
  };
}

function insertAppointment(db: Database.Database, organisationId: string, importId: string, row: ReturnType<typeof readRow>) {
  let leadId: string | null = null;
  if (row.phone || row.name) {
    const existing = row.phone
      ? (db.prepare(`SELECT id FROM ops_leads WHERE organisation_id = ? AND phone = ?`).get(organisationId, row.phone) as { id: string } | undefined)
      : undefined;
    leadId = existing?.id ?? crypto.randomUUID();
    if (!existing) {
      db.prepare(
        `INSERT INTO ops_leads (id, organisation_id, import_id, name, phone, owner_name, stage, tags, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(leadId, organisationId, importId, row.name, row.phone, row.setter, row.stage, row.tags, row.status, row.bookedAt);
    }
  }
  db.prepare(
    `INSERT INTO ops_appointments (
      id, organisation_id, import_id, lead_id, setter_name, campaign_name, booked_at, scheduled_at, status,
      booking_delay_days, confirmation_recorded, partner_uncertain, reschedule_requested, attendance_evidence,
      evidence_type, rebooking_attempted, pipeline_stage, tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    organisationId,
    importId,
    leadId,
    row.setter,
    row.campaign,
    row.bookedAt,
    row.scheduledAt,
    row.status,
    row.delay,
    row.confirmation,
    row.partner,
    row.reschedule,
    row.evidence,
    row.evidenceType,
    row.rebooking,
    row.stage,
    row.tags,
  );
}

function value(record: Record<string, string>, column: string | undefined) {
  if (!column) return "";
  return record[column] ?? "";
}

function clean(value: string) {
  const text = value.trim();
  return text || null;
}

function normalStatus(value: string | null | undefined) {
  const key = (value ?? "").trim().toLowerCase();
  return STATUSES[key] ?? null;
}

function flag(value: string | null | undefined) {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (["1", "yes", "y", "true"].includes(text)) return 1;
  if (["0", "no", "n", "false"].includes(text)) return 0;
  return null;
}
