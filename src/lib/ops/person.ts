import type Database from "better-sqlite3";
import { phoneKey } from "@/lib/ops/phone";

export function assignPeople(db: Database.Database) {
  const leads = db.prepare(`SELECT id, name, phone, email FROM ops_leads WHERE phone IS NOT NULL OR email IS NOT NULL`).all() as Array<{ id: string; name: string | null; phone: string | null; email: string | null }>;
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  let linked = 0;
  const update = db.prepare(`UPDATE ops_leads SET person_id = ? WHERE id = ?`);
  for (const lead of leads) {
    const key = phoneKey(lead.phone);
    const email = lead.email?.trim().toLowerCase() || null;
    let personId = key ? byPhone.get(key) : undefined;
    if (!personId && email) personId = byEmail.get(email);
    if (!personId) {
      const existing = key
        ? (db.prepare(`SELECT id FROM ops_people WHERE phone_key = ?`).get(key) as { id: string } | undefined)
        : email
          ? (db.prepare(`SELECT id FROM ops_people WHERE email = ?`).get(email) as { id: string } | undefined)
          : undefined;
      personId = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        db.prepare(`INSERT INTO ops_people (id, phone_key, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)`).run(personId, key, email, lead.name, new Date().toISOString());
      }
    }
    if (key) byPhone.set(key, personId);
    if (email) byEmail.set(email, personId);
    update.run(personId, lead.id);
    linked += 1;
  }
  db.prepare(
    `UPDATE ops_activities
     SET person_id = (SELECT person_id FROM ops_leads WHERE ops_leads.id = ops_activities.lead_id)
     WHERE lead_id IS NOT NULL`,
  ).run();
  db.prepare(
    `UPDATE ops_appointments
     SET person_id = (SELECT person_id FROM ops_leads WHERE ops_leads.id = ops_appointments.lead_id)
     WHERE lead_id IS NOT NULL`,
  ).run();
  return linked;
}
