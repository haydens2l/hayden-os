import type Database from "better-sqlite3";
import { getConnection, markSync, readSecret, saveConnection } from "@/lib/integrations/connections";
import { readSyncState, writeSyncState } from "@/lib/ops/sync-state";

export type GhlSecret = { token: string; locationId: string };

export type GhlContact = {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  dateAdded?: string | null;
  tags?: string[];
};

export type GhlEvent = {
  id?: string;
  title?: string | null;
  contactId?: string | null;
  appointmentStatus?: string | null;
  startTime?: string | number | null;
  endTime?: string | number | null;
  dateAdded?: string | number | null;
  dateUpdated?: string | number | null;
  assignedUserId?: string | null;
};

export type GhlOpportunity = {
  id?: string;
  pipelineStageId?: string;
  assignedTo?: string | null;
  status?: string | null;
  source?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastStageChangeAt?: string | null;
  contact?: { id?: string | null; name?: string | null; phone?: string | null; email?: string | null };
};

const ROOT = "https://services.leadconnectorhq.com";

const STATUS_MAP: Record<string, string> = {
  showed: "sat",
  show: "sat",
  attended: "sat",
  sat: "sat",
  noshow: "no_show",
  no_show: "no_show",
  "no-show": "no_show",
  "no show": "no_show",
  cancelled: "cancelled",
  canceled: "cancelled",
  confirmed: "booked",
  unconfirmed: "booked",
  new: "booked",
  booked: "booked",
};

export function ghlConfigured(db: Database.Database) {
  const connection = getConnection(db, "gohighlevel");
  return connection.hasSecret && Boolean(connection.organisationId);
}

export async function connectGhl(db: Database.Database, input: { organisationId: string; token: string; locationId: string }) {
  const existing = readSecret<GhlSecret>(db, "gohighlevel");
  const secret = {
    token: input.token.trim() || existing?.token || process.env.GHL_PRIVATE_TOKEN?.trim() || "",
    locationId: input.locationId.trim() || existing?.locationId || process.env.GHL_LOCATION_ID?.trim() || "",
  };
  if (!secret.token || !secret.locationId) throw new Error("GoHighLevel needs a private integration token and a location ID.");
  if (!input.organisationId) throw new Error("Choose which business this location belongs to.");
  const check = await ghlGet(secret.token, `/locations/${encodeURIComponent(secret.locationId)}`);
  const label = check.ok ? String((check.body.location as { name?: string } | undefined)?.name || (check.body.name as string) || "GoHighLevel") : "GoHighLevel";
  if (!check.ok) {
    saveConnection(db, { id: "gohighlevel", organisationId: input.organisationId, accountLabel: label, secret, status: "error", error: check.message });
    throw new Error(check.message);
  }
  saveConnection(db, { id: "gohighlevel", organisationId: input.organisationId, accountLabel: label, secret, status: "connected", error: null });
}

export function routeGhlPipeline(name: string | null | undefined) {
  const label = (name ?? "").trim();
  if (label === "Meta") return { organisationId: "fifo", angle: "tax leak" };
  if (label === "Paid off home") return { organisationId: "fifo", angle: "paid off" };
  if (label === "Brisbane Paid off") return { organisationId: "inception", angle: "brisbane paid off" };
  return null;
}

export async function syncGhl(db: Database.Database) {
  const connection = getConnection(db, "gohighlevel");
  const secret = readSecret<GhlSecret>(db, "gohighlevel");
  if (!secret || !connection.organisationId) throw new Error("GoHighLevel is not connected to a business yet.");
  const pipelinesResult = await ghlGet(secret.token, `/opportunities/pipelines?locationId=${encodeURIComponent(secret.locationId)}`);
  if (!pipelinesResult.ok) {
    const failed = readSyncState(db, "gohighlevel");
    writeSyncState(db, { ...failed, lastAttemptedAt: new Date().toISOString(), error: pipelinesResult.message });
    markSync(db, "gohighlevel", connection.lastSummary ?? "", pipelinesResult.message);
    throw new Error(pipelinesResult.message);
  }
  const pipelines = (pipelinesResult.body.pipelines ?? []) as Array<{ id?: string; name?: string; stages?: Array<{ id?: string; name?: string }> }>;
  const users = await ghlUsers(secret.token, secret.locationId);
  const state = readSyncState(db, "gohighlevel");
  const attempted = new Date().toISOString();
  const full = !state.fullScanAt || Date.now() - Date.parse(state.fullScanAt) > 6 * 3600000;
  const stored = { added: 0, updated: 0, byKey: {} as Record<string, number> };
  let latest = state.latestSourceAt;
  const partial: string[] = [];
  for (const pipeline of pipelines) {
    const route = routeGhlPipeline(pipeline.name);
    if (!route || !pipeline.id) continue;
    const stages = new Map((pipeline.stages ?? []).map((stage) => [stage.id, stage.name ?? ""]));
    try {
      const opportunities = await listOpportunities(secret.token, secret.locationId, pipeline.id, full ? null : state.latestSourceAt);
      const count = storeGhlOpportunities(db, route.organisationId, route.angle, pipeline.name ?? route.angle, stages, users, opportunities);
      stored.added += count.added;
      stored.updated += count.updated;
      stored.byKey[`${route.organisationId}:${route.angle}`] = count.added + count.updated;
      for (const opportunity of opportunities) {
        const stamp = opportunity.updatedAt || opportunity.lastStageChangeAt || opportunity.createdAt;
        if (stamp && (!latest || stamp > latest)) latest = stamp;
      }
      for (const stage of pipeline.stages ?? []) {
        if (!/no show/i.test(stage.name ?? "") || !stage.id) continue;
        const stageRows = await listOpportunities(secret.token, secret.locationId, pipeline.id, null, stage.id, 1);
        const stageCount = storeGhlOpportunities(db, route.organisationId, route.angle, pipeline.name ?? route.angle, stages, users, stageRows);
        stored.added += stageCount.added;
        stored.updated += stageCount.updated;
      }
    } catch (error) {
      partial.push(`${pipeline.name}: ${error instanceof Error ? error.message : "pull failed"}`);
    }
  }
  let appointments = 0;
  try {
    appointments = await syncGhlAppointments(db, secret.token, secret.locationId, users);
  } catch (error) {
    partial.push(`appointments: ${error instanceof Error ? error.message : "pull failed"}`);
  }
  const summary = `${stored.added} leads added, ${stored.updated} updated. ${appointments} appointments refreshed. ${full ? "Full pipeline scan." : "Recent records only."} Other pipelines were left out. Nothing was written back to GoHighLevel.`;
  const error = partial.length && stored.added + stored.updated + appointments === 0 ? partial.join(" ") : null;
  writeSyncState(db, {
    ...state,
    cursor: latest,
    lastAttemptedAt: attempted,
    lastSuccessfulAt: error ? state.lastSuccessfulAt : new Date().toISOString(),
    latestSourceAt: latest,
    recordsAdded: stored.added,
    recordsUpdated: stored.updated,
    transcriptsDiscovered: state.transcriptsDiscovered,
    error,
    partialError: partial.length ? partial.join(" ") : null,
    fullScanAt: full && !error ? new Date().toISOString() : state.fullScanAt,
  });
  markSync(db, "gohighlevel", summary, error);
  if (error) throw new Error(error);
  return summary;
}

async function listOpportunities(token: string, locationId: string, pipelineId: string, cursor: string | null = null, stageId?: string, maxPages = 40) {
  const rows: GhlOpportunity[] = [];
  let startAfter = "";
  let startAfterId = "";
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ location_id: locationId, pipeline_id: pipelineId, limit: "100" });
    if (stageId) params.set("pipeline_stage_id", stageId);
    if (startAfterId) {
      params.set("startAfter", startAfter);
      params.set("startAfterId", startAfterId);
    }
    const result = await ghlGet(token, `/opportunities/search?${params.toString()}`);
    if (!result.ok) throw new Error(result.message);
    const batch = (result.body.opportunities ?? []) as GhlOpportunity[];
    rows.push(...batch);
    if (cursor && batch.every((row) => [row.updatedAt, row.createdAt, row.lastStageChangeAt].every((stamp) => !stamp || stamp <= cursor))) break;
    const meta = (result.body.meta ?? {}) as { nextPage?: string | number | null; startAfter?: number; startAfterId?: string; total?: number };
    if (!batch.length || meta.nextPage === "" || meta.nextPage == null || !meta.startAfterId || seen.has(meta.startAfterId)) break;
    if (typeof meta.total === "number" && rows.length >= meta.total) break;
    seen.add(meta.startAfterId);
    startAfter = String(meta.startAfter ?? "");
    startAfterId = meta.startAfterId;
  }
  return rows;
}

export function storeGhlOpportunities(
  db: Database.Database,
  organisationId: string,
  angle: string,
  pipelineName: string,
  stages: Map<string | undefined, string>,
  users: Map<string, string>,
  opportunities: GhlOpportunity[],
) {
  let added = 0;
  let updated = 0;
  for (const opportunity of opportunities) {
    if (!opportunity.id) continue;
    const stage = stages.get(opportunity.pipelineStageId) || null;
    const contact = opportunity.contact;
    const owner = opportunity.assignedTo ? users.get(opportunity.assignedTo) ?? null : null;
    const source = opportunity.source ?? null;
    const existing = db
      .prepare(`SELECT id FROM ops_leads WHERE organisation_id = ? AND external_source = 'gohighlevel' AND external_id = ?`)
      .get(organisationId, opportunity.id) as { id: string } | undefined;
    if (existing) {
      db.prepare(`UPDATE ops_leads SET name = ?, phone = ?, email = ?, stage = ?, tags = ?, source_name = ?, pipeline_name = ?, lead_source = ?, status = ?, owner_name = ?, contact_external_id = ?, stage_changed_at = ? WHERE id = ?`).run(
        contact?.name ?? null,
        contact?.phone ?? null,
        contact?.email ?? null,
        stage,
        angle,
        pipelineName,
        pipelineName,
        source,
        opportunity.status ?? "stored",
        owner,
        contact?.id ?? null,
        opportunity.lastStageChangeAt ?? null,
        existing.id,
      );
      updated += 1;
    } else {
      db.prepare(
        `INSERT INTO ops_leads (id, organisation_id, name, phone, email, owner_name, source_name, pipeline_name, lead_source, stage, tags, status, created_at, stage_changed_at, external_id, external_source, contact_external_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gohighlevel', ?)`,
      ).run(crypto.randomUUID(), organisationId, contact?.name ?? null, contact?.phone ?? null, contact?.email ?? null, owner, pipelineName, pipelineName, source, stage, angle, opportunity.status ?? "stored", opportunity.createdAt ?? null, opportunity.lastStageChangeAt ?? null, opportunity.id, contact?.id ?? null);
      added += 1;
    }
  }
  return { added, updated };
}

async function ghlUsers(token: string, locationId: string) {
  const result = await ghlGet(token, `/users/?locationId=${encodeURIComponent(locationId)}`);
  const users = (result.ok ? result.body.users ?? [] : []) as Array<{ id?: string; name?: string; firstName?: string; lastName?: string }>;
  return new Map(users.filter((user) => user.id).map((user) => [user.id as string, user.name || [user.firstName, user.lastName].filter(Boolean).join(" ")]));
}

async function syncGhlAppointments(db: Database.Database, token: string, locationId: string, users: Map<string, string>) {
  const calendars = await ghlGet(token, `/calendars/?locationId=${encodeURIComponent(locationId)}`);
  if (!calendars.ok) return 0;
  const start = Date.now() - 21 * 86400000;
  const end = Date.now() + 21 * 86400000;
  let stored = 0;
  for (const calendar of ((calendars.body.calendars ?? []) as Array<{ id?: string; name?: string }>).slice(0, 20)) {
    if (!calendar.id) continue;
    const events = await ghlGet(token, `/calendars/events?locationId=${encodeURIComponent(locationId)}&calendarId=${encodeURIComponent(calendar.id)}&startTime=${start}&endTime=${end}`);
    if (!events.ok) continue;
    for (const event of (events.body.events ?? []) as GhlEvent[]) {
      if (!event.id || !event.contactId) continue;
      const lead = db.prepare(`SELECT id, organisation_id FROM ops_leads WHERE external_source = 'gohighlevel' AND contact_external_id = ? ORDER BY CASE WHEN lower(COALESCE(stage, '')) LIKE '%book%' OR lower(COALESCE(stage, '')) LIKE '%no show%' OR lower(COALESCE(stage, '')) LIKE '%sat%' OR lower(COALESCE(stage, '')) LIKE '%shown%' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`).get(event.contactId) as { id: string; organisation_id: string } | undefined;
      const fifoCalendar = /fifo investor/i.test(calendar.name ?? "");
      if (!lead && !fifoCalendar) continue;
      const organisationId = lead?.organisation_id ?? "fifo";
      const mapped = mapAppointmentStatus(event.appointmentStatus);
      const start = eventInstant(event.startTime);
      const end = eventInstant(event.endTime);
      const booked = eventInstant(event.dateAdded);
      const delay = start.iso && booked.iso ? Math.round((Date.parse(start.iso) - Date.parse(booked.iso)) / 86400000) : null;
      const setter = event.assignedUserId ? users.get(event.assignedUserId) ?? null : null;
      const confirmed = (event.appointmentStatus ?? "").toLowerCase() === "confirmed" ? 1 : 0;
      const updated = eventInstant(event.dateUpdated).iso;
      const existing = db.prepare(`SELECT id FROM ops_appointments WHERE external_source = 'gohighlevel' AND external_id = ?`).get(event.id) as { id: string } | undefined;
      if (existing) {
        db.prepare(`UPDATE ops_appointments SET organisation_id = ?, lead_id = ?, setter_name = ?, campaign_name = ?, booked_at = ?, scheduled_at = ?, ends_at = ?, scheduled_timezone = ?, time_unknown = ?, source_updated_at = ?, status = ?, booking_delay_days = ?, confirmation_recorded = ? WHERE id = ?`).run(organisationId, lead?.id ?? null, setter, calendar.name ?? null, booked.iso, start.iso, end.timeUnknown ? null : end.iso, start.timezone, start.timeUnknown ? 1 : 0, updated, mapped.status, delay, confirmed, existing.id);
      } else {
        db.prepare(
          `INSERT INTO ops_appointments (id, organisation_id, lead_id, setter_name, campaign_name, booked_at, scheduled_at, ends_at, scheduled_timezone, time_unknown, source_updated_at, status, booking_delay_days, confirmation_recorded, external_id, external_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gohighlevel')`,
        ).run(crypto.randomUUID(), organisationId, lead?.id ?? null, setter, calendar.name ?? null, booked.iso, start.iso, end.timeUnknown ? null : end.iso, start.timezone, start.timeUnknown ? 1 : 0, updated, mapped.status, delay, confirmed, event.id);
      }
      stored += 1;
    }
  }
  return stored;
}

export function storeGhlRecords(db: Database.Database, organisationId: string, contacts: GhlContact[], events: GhlEvent[]) {
  let contactCount = 0;
  let appointments = 0;
  let unrecognised = 0;
  for (const contact of contacts) {
    if (!contact.id) continue;
    upsertContact(db, organisationId, contact);
    contactCount += 1;
  }
  for (const event of events) {
    if (!event.id || !event.startTime) continue;
    const mapped = mapAppointmentStatus(event.appointmentStatus);
    if (!mapped.known) unrecognised += 1;
    upsertAppointment(db, organisationId, event, mapped.status);
    appointments += 1;
  }
  return { contacts: contactCount, appointments, unrecognised };
}

export function mapAppointmentStatus(raw: string | null | undefined) {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return { status: "status not stored", known: false };
  const status = STATUS_MAP[key];
  if (!status) return { status: key, known: false };
  return { status, known: true };
}

async function ghlGet(token: string, path: string, attempt = 0) {
  try {
    const response = await fetch(`${ROOT}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
    });
    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return ghlGet(token, path, attempt + 1);
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof body.message === "string" ? body.message : `GoHighLevel returned ${response.status}.`;
      return { ok: false as const, message, body };
    }
    return { ok: true as const, body };
  } catch {
    return { ok: false as const, message: "GoHighLevel could not be reached.", body: {} };
  }
}

function upsertContact(db: Database.Database, organisationId: string, contact: GhlContact) {
  const existing = db.prepare(`SELECT id FROM ops_leads WHERE organisation_id = ? AND external_source = 'gohighlevel' AND external_id = ?`).get(organisationId, contact.id) as { id: string } | undefined;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null;
  const tags = (contact.tags ?? []).join(", ") || null;
  if (existing) {
    db.prepare(`UPDATE ops_leads SET name = ?, phone = ?, tags = ? WHERE id = ?`).run(name, contact.phone ?? null, tags, existing.id);
    return;
  }
  db.prepare(
    `INSERT INTO ops_leads (id, organisation_id, name, phone, tags, status, created_at, external_id, external_source)
     VALUES (?, ?, ?, ?, ?, 'stored', ?, ?, 'gohighlevel')`,
  ).run(crypto.randomUUID(), organisationId, name, contact.phone ?? null, tags, contact.dateAdded ?? null, contact.id);
}

function eventInstant(start: string | number | null | undefined) {
  if (start == null || start === "") return { iso: null as string | null, timeUnknown: true, timezone: null as string | null };
  if (typeof start === "number" || /^\d+$/.test(String(start))) {
    const date = new Date(Number(start));
    if (Number.isNaN(date.getTime())) return { iso: null, timeUnknown: true, timezone: null };
    return { iso: date.toISOString(), timeUnknown: false, timezone: "UTC" };
  }
  const text = String(start);
  const timezone = text.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] ?? null;
  const timeUnknown = !/T\d{2}:\d{2}/.test(text);
  if (Number.isNaN(Date.parse(text))) return { iso: timeUnknown ? text.slice(0, 10) : null, timeUnknown: true, timezone };
  return { iso: text, timeUnknown, timezone };
}

function eventDay(start: string | number | null | undefined) {
  if (start == null || start === "") return null;
  if (typeof start === "number" || /^\d+$/.test(start)) return new Date(Number(start)).toISOString().slice(0, 10);
  return start.slice(0, 10);
}

function upsertAppointment(db: Database.Database, organisationId: string, event: GhlEvent, status: string) {
  const day = eventDay(event.startTime);
  const lead = event.contactId
    ? (db.prepare(`SELECT id FROM ops_leads WHERE organisation_id = ? AND external_source = 'gohighlevel' AND external_id = ?`).get(organisationId, event.contactId) as { id: string } | undefined)
    : undefined;
  const existing = db.prepare(`SELECT id FROM ops_appointments WHERE organisation_id = ? AND external_source = 'gohighlevel' AND external_id = ?`).get(organisationId, event.id) as { id: string } | undefined;
  if (existing) {
    db.prepare(`UPDATE ops_appointments SET status = ?, scheduled_at = ?, lead_id = ? WHERE id = ?`).run(status, day, lead?.id ?? null, existing.id);
    return;
  }
  db.prepare(
    `INSERT INTO ops_appointments (id, organisation_id, lead_id, scheduled_at, status, external_id, external_source)
     VALUES (?, ?, ?, ?, ?, ?, 'gohighlevel')`,
  ).run(crypto.randomUUID(), organisationId, lead?.id ?? null, day, status, event.id);
}
