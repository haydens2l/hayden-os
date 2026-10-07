import type Database from "better-sqlite3";
import { phoneKey } from "@/lib/ops/phone";

export function linkCallsToLeads(db: Database.Database) {
  const leads = db.prepare(`SELECT id, organisation_id, phone, stage, created_at FROM ops_leads WHERE external_source = 'gohighlevel' AND phone IS NOT NULL`).all() as Array<{
    id: string;
    organisation_id: string;
    phone: string;
    stage: string | null;
    created_at: string | null;
  }>;
  const byPhone = new Map<string, typeof leads>();
  for (const lead of leads) {
    const key = `${lead.organisation_id}:${phoneKey(lead.phone)}`;
    if (!phoneKey(lead.phone)) continue;
    const list = byPhone.get(key) ?? [];
    list.push(lead);
    byPhone.set(key, list);
  }
  const calls = db.prepare(
    `SELECT a.id, a.organisation_id, l.phone
     FROM ops_activities a
     JOIN ops_leads l ON l.id = a.lead_id
     WHERE a.external_source = 'aircall' AND l.phone IS NOT NULL`,
  ).all() as Array<{ id: string; organisation_id: string; phone: string }>;
  let linked = 0;
  const update = db.prepare(`UPDATE ops_activities SET lead_id = ? WHERE id = ?`);
  for (const call of calls) {
    const key = phoneKey(call.phone);
    const matches = key ? byPhone.get(`${call.organisation_id}:${key}`) : undefined;
    if (!matches?.length) continue;
    const lead = [...matches].sort((a, b) => rank(b.stage) - rank(a.stage) || (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
    update.run(lead.id, call.id);
    linked += 1;
  }
  return linked;
}

function rank(stage: string | null) {
  const value = (stage ?? "").toLowerCase();
  if (/book|no show|sat|shown|had call/.test(value)) return 2;
  if (/callback|pending/.test(value)) return 1;
  return 0;
}
