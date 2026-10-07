import type Database from "better-sqlite3";
import { getConnection, markSync, readSecret, saveConnection } from "@/lib/integrations/connections";
import { readSyncState, writeSyncState } from "@/lib/ops/sync-state";

export type AircallSecret = { apiId: string; apiToken: string };

export type AircallCall = {
  id: number;
  direction?: string;
  status?: string;
  started_at?: number;
  answered_at?: number | null;
  duration?: number | null;
  direct_link?: string | null;
  raw_digits?: string;
  number?: { id?: number; name?: string | null };
  user?: { name?: string | null };
  contact?: { id?: number; first_name?: string | null; last_name?: string | null; phone_numbers?: Array<{ value?: string }> };
};

const ROOT = "https://api.aircall.io/v1";

export function aircallConfigured(db: Database.Database) {
  const connection = getConnection(db, "aircall");
  return connection.hasSecret && Boolean(connection.organisationId);
}

export async function connectAircall(db: Database.Database, input: { organisationId: string; apiId: string; apiToken: string }) {
  const apiId = input.apiId.trim();
  const apiToken = input.apiToken.trim();
  const existing = readSecret<AircallSecret>(db, "aircall");
  const secret = {
    apiId: apiId || existing?.apiId || process.env.AIRCALL_API_ID?.trim() || "",
    apiToken: apiToken || existing?.apiToken || process.env.AIRCALL_API_TOKEN?.trim() || "",
  };
  if (!secret.apiId || !secret.apiToken) throw new Error("Aircall needs an API ID and an API token.");
  if (!input.organisationId) throw new Error("Choose which business these calls belong to.");
  const ping = await aircallGet(secret, "/ping");
  const company = ping.ok ? await aircallGet(secret, "/company") : ping;
  const label = company.ok ? (company.body.company as { name?: string } | undefined)?.name || "Aircall" : "Aircall";
  if (!ping.ok) {
    saveConnection(db, { id: "aircall", organisationId: input.organisationId, accountLabel: label, secret, status: "error", error: ping.message });
    throw new Error(ping.message);
  }
  saveConnection(db, { id: "aircall", organisationId: input.organisationId, accountLabel: label, secret, status: "connected", error: null });
}

export async function syncAircall(db: Database.Database) {
  const connection = getConnection(db, "aircall");
  const secret = readSecret<AircallSecret>(db, "aircall");
  if (!secret || !connection.organisationId) throw new Error("Aircall is not connected to a business yet.");
  const now = Math.floor(Date.now() / 1000);
  const state = readSyncState(db, "aircall");
  const attempted = new Date().toISOString();
  const storedLatest = (db.prepare(`SELECT MAX(occurred_at) AS v FROM ops_activities WHERE external_source = 'aircall'`).get() as { v: string | null }).v;
  const cursor = state.cursor ? Number(state.cursor) : storedLatest ? Math.floor(Date.parse(storedLatest) / 1000) : now - 14 * 86400;
  const from = Math.max(0, cursor - 120);
  const calls: AircallCall[] = [];
  let reportedTotal = 0;
  let partial: string | null = null;
  for (let page = 1; page <= 30; page += 1) {
    const result = await aircallGet(secret, `/calls?from=${from}&to=${now}&per_page=50&page=${page}&order=desc&fetch_contact=true`);
    if (!result.ok) {
      writeSyncState(db, { ...state, lastAttemptedAt: attempted, error: result.message });
      markSync(db, "aircall", connection.lastSummary ?? "", result.message);
      throw new Error(result.message);
    }
    if (page === 1) reportedTotal = result.body.meta?.total ?? 0;
    const batch = (result.body.calls ?? []) as AircallCall[];
    calls.push(...batch);
    if (!result.body.meta?.next_page_link) break;
    if (page === 30) partial = "Stopped at 30 pages. The next sync continues from the latest call stored.";
  }
  const stored = storeAircallCalls(db, null, calls);
  const names = new Map(
    (db.prepare(`SELECT id, name FROM organisations`).all() as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
  );
  const parts = Object.entries(stored.byOrganisation).map(([id, count]) => `${names.get(id) ?? id}: ${count} calls`);
  const cap = reportedTotal > calls.length ? ` ${calls.length} of ${reportedTotal} calls in the window were read.` : "";
  const latestUnix = calls.reduce((max, call) => Math.max(max, call.started_at ?? 0), cursor);
  const summary = `${parts.join(". ") || "No mapped calls"}. ${stored.added} new, ${stored.updated} updated. ${stored.skipped} calls were on lines that are not mapped to a business.${cap} ${partial ?? "Transcripts are read only for booking calls."}`;
  writeSyncState(db, {
    ...state,
    cursor: String(latestUnix),
    lastAttemptedAt: attempted,
    lastSuccessfulAt: new Date().toISOString(),
    latestSourceAt: new Date(latestUnix * 1000).toISOString(),
    recordsAdded: stored.added,
    recordsUpdated: stored.updated,
    transcriptsDiscovered: state.transcriptsDiscovered,
    error: null,
    partialError: partial,
    fullScanAt: state.fullScanAt,
  });
  markSync(db, "aircall", summary, partial);
  for (const [organisationId, count] of Object.entries(stored.byOrganisation)) recordImport(db, organisationId, "Aircall", count);
  return summary;
}

export function organisationForAircallNumber(name: string | null | undefined) {
  const label = (name ?? "").trim();
  if (/fifo investor/i.test(label)) return "fifo";
  if (/^iwg\b/i.test(label)) return "inception";
  return null;
}

export function storeAircallCalls(db: Database.Database, fallbackOrganisationId: string | null, calls: AircallCall[]) {
  const leadIds = new Set<string>();
  const byOrganisation: Record<string, number> = {};
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const call of calls) {
    const organisationId = organisationForAircallNumber(call.number?.name) ?? fallbackOrganisationId;
    if (!organisationId) {
      skipped += 1;
      continue;
    }
    const phone = call.contact?.phone_numbers?.[0]?.value || call.raw_digits || null;
    const name = [call.contact?.first_name, call.contact?.last_name].filter(Boolean).join(" ") || null;
    let leadId: string | null = null;
    if (call.contact?.id || phone) {
      leadId = upsertLead(db, {
        organisationId,
        externalId: call.contact?.id ? String(call.contact.id) : phone,
        name,
        phone,
        owner: call.user?.name ?? null,
      });
      if (leadId) leadIds.add(leadId);
    }
    const when = call.started_at ? new Date(call.started_at * 1000).toISOString() : null;
    const outcome = call.answered_at ? "answered" : call.status || "status not stored";
    const saved = upsertActivity(db, {
      organisationId,
      externalId: String(call.id),
      leadId,
      actor: call.user?.name ?? null,
      occurredAt: when,
      outcome: `${call.direction || "call"} · ${outcome}${call.number?.name ? ` · ${call.number.name}` : ""}`,
      duration: call.duration ?? null,
      sourceUrl: call.direct_link ?? null,
    });
    if (saved === "added") added += 1;
    else updated += 1;
    byOrganisation[organisationId] = (byOrganisation[organisationId] ?? 0) + 1;
  }
  return { calls: added + updated, added, updated, leads: leadIds.size, skipped, byOrganisation };
}

async function aircallGet(secret: AircallSecret, path: string, attempt = 0) {
  const encoded = Buffer.from(`${secret.apiId}:${secret.apiToken}`).toString("base64");
  try {
    const response = await fetch(`${ROOT}${path}`, { headers: { Authorization: `Basic ${encoded}`, Accept: "application/json" } });
    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return aircallGet(secret, path, attempt + 1);
    }
    const body = (await response.json().catch(() => ({}))) as { calls?: AircallCall[]; meta?: { next_page_link?: string | null; total?: number }; error?: string; ping?: string; company?: { name?: string } };
    if (!response.ok) return { ok: false as const, message: body.error || `Aircall returned ${response.status}.`, body };
    return { ok: true as const, body };
  } catch {
    return { ok: false as const, message: "Aircall could not be reached.", body: {} };
  }
}

function upsertLead(db: Database.Database, input: { organisationId: string; externalId: string | null; name: string | null; phone: string | null; owner: string | null }) {
  const existing = db
    .prepare(`SELECT id FROM ops_leads WHERE organisation_id = ? AND external_source = 'aircall' AND external_id = ?`)
    .get(input.organisationId, input.externalId) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ops_leads (id, organisation_id, name, phone, owner_name, status, external_id, external_source)
     VALUES (?, ?, ?, ?, ?, 'stored', ?, 'aircall')`,
  ).run(id, input.organisationId, input.name, input.phone, input.owner, input.externalId);
  return id;
}

function upsertActivity(db: Database.Database, input: { organisationId: string; externalId: string; leadId: string | null; actor: string | null; occurredAt: string | null; outcome: string; duration?: number | null; sourceUrl?: string | null }) {
  const existing = db
    .prepare(`SELECT id FROM ops_activities WHERE organisation_id = ? AND external_source = 'aircall' AND external_id = ?`)
    .get(input.organisationId, input.externalId) as { id: string } | undefined;
  if (existing) {
    db.prepare(`UPDATE ops_activities SET outcome = ?, occurred_at = ?, actor_name = ?, duration_seconds = ?, source_url = ?, lead_id = COALESCE(lead_id, ?) WHERE id = ?`).run(input.outcome, input.occurredAt, input.actor, input.duration ?? null, input.sourceUrl ?? null, input.leadId, existing.id);
    return "updated" as const;
  }
  db.prepare(
    `INSERT INTO ops_activities (id, organisation_id, lead_id, kind, actor_name, occurred_at, outcome, duration_seconds, source_url, external_id, external_source)
     VALUES (?, ?, ?, 'dial', ?, ?, ?, ?, ?, ?, 'aircall')`,
  ).run(crypto.randomUUID(), input.organisationId, input.leadId, input.actor, input.occurredAt, input.outcome, input.duration ?? null, input.sourceUrl ?? null, input.externalId);
  return "added" as const;
}

function recordImport(db: Database.Database, organisationId: string, sourceName: string, accepted: number) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ops_imports (id, organisation_id, source_name, source_kind, imported_at, schema_mapping, rows_accepted, rows_rejected, validation_issues, file_name)
     VALUES (?, ?, ?, ?, ?, '{}', ?, 0, '[]', ?)`,
  ).run(crypto.randomUUID(), organisationId, sourceName, sourceName.toLowerCase(), now, accepted, sourceName);
}
