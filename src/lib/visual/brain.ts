import type Database from "better-sqlite3";

export type VisualRule = {
  id: string;
  scope: string;
  organisation_id: string | null;
  title: string;
  body: string;
  status: string;
  confidence: string | null;
  source_name: string | null;
};

export function approvedVisualRules(db: Database.Database, organisationId: string | null) {
  return db
    .prepare(
      `SELECT id, scope, organisation_id, title, body, status, confidence, source_name
       FROM visual_rules
       WHERE status = 'approved' AND superseded_by_id IS NULL
         AND (scope = 'global' OR organisation_id = ?)
       ORDER BY scope, title`,
    )
    .all(organisationId) as VisualRule[];
}

export function suggestVisualRule(db: Database.Database, input: { organisationId: string | null; title: string; body: string; key: string }) {
  const existing = db.prepare(`SELECT id, status FROM visual_rules WHERE rule_key = ? AND organisation_id IS ? AND status != 'rejected'`).get(input.key, input.organisationId) as
    | { id: string; status: string }
    | undefined;
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO visual_rules (
      id, scope, organisation_id, rule_key, title, body, source_type, source_name, status, confidence, created_at
    ) VALUES (?, 'brand', ?, ?, ?, ?, 'observation', 'Repeated Hayden feedback', 'suggested', 'low', ?)`,
  ).run(id, input.organisationId, input.key, input.title, input.body, new Date().toISOString());
  return id;
}

export function decideSuggestedRule(db: Database.Database, id: string, decision: "approved" | "rejected" | "edited", body?: string) {
  if (decision === "edited") {
    db.prepare(`UPDATE visual_rules SET body = ?, status = 'approved', approved_by = 'hayden', confidence = 'medium' WHERE id = ?`).run((body ?? "").trim(), id);
    return;
  }
  db.prepare(`UPDATE visual_rules SET status = ?, approved_by = ? WHERE id = ?`).run(decision, decision === "approved" ? "hayden" : null, id);
}
