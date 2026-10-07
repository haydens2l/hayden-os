import type Database from "better-sqlite3";

export function proposeRule(feedback: string, brand: string | null) {
  const text = feedback.trim();
  const lower = text.toLowerCase();
  if (!text) return null;
  const reusable = /never|always|don'?t|do not|should feel|too corporate|logo|every time|from now/.test(lower);
  const oneOff = /scene \d|first three seconds|this clip|this video/.test(lower) && !/never|always|don'?t|do not/.test(lower);
  if (!reusable || oneOff) return null;
  if (/corporate/.test(lower)) {
    const who = brand ?? "These";
    return {
      title: "Everyday characters",
      body: `${who} characters should feel like normal everyday Australians rather than polished corporate talent.`,
    };
  }
  if (/logo/.test(lower)) {
    return { title: "No logo on the final frame", body: "Never put the logo on the final frame." };
  }
  return { title: "Production preference", body: text.endsWith(".") ? text : `${text}.` };
}

export function saveSuggestion(db: Database.Database, id: string) {
  const row = db.prepare(`SELECT * FROM rule_suggestions WHERE id = ?`).get(id) as
    | {
        id: string;
        title: string;
        body: string;
        organisation_id: string | null;
        status: string;
      }
    | undefined;
  if (!row) throw new Error("That suggestion is not stored.");
  if (row.status === "saved") return row.id;
  const ruleId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO production_rules (
      id, rule_key, scope, organisation_id, title, body, source_type, source_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'manual', 'Hayden review', ?)`,
  ).run(
    ruleId,
    `feedback-${ruleId.slice(0, 8)}`,
    row.organisation_id ? "organisation" : "global",
    row.organisation_id,
    row.title,
    row.body,
    now,
  );
  db.prepare(`UPDATE rule_suggestions SET status = 'saved' WHERE id = ?`).run(id);
  return ruleId;
}

export function dismissSuggestion(db: Database.Database, id: string) {
  db.prepare(`UPDATE rule_suggestions SET status = 'dismissed' WHERE id = ? AND status = 'pending'`).run(id);
}

export function pendingSuggestion(db: Database.Database, sourceType: string, sourceId: string) {
  return db
    .prepare(
      `SELECT id, title, body, feedback, status FROM rule_suggestions
       WHERE source_type = ? AND source_id = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(sourceType, sourceId) as { id: string; title: string; body: string; feedback: string; status: string } | undefined;
}
