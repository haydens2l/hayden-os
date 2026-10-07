import type Database from "better-sqlite3";
import { CONTEXT_TYPES, type ContextType } from "./labels";

export function supersedeKnowledge(
  db: Database.Database,
  input: { oldId: string; title: string; content: string; organisationId?: string | null },
) {
  const old = db.prepare(`SELECT id, organisation_id FROM knowledge WHERE id = ?`).get(input.oldId) as
    | { id: string; organisation_id: string | null }
    | undefined;
  if (!old) throw new Error("That record is not in memory.");
  const content = input.content.trim();
  const title = input.title.trim();
  if (!content || !title) throw new Error("A replacement needs a title and the new direction.");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const apply = db.transaction(() => {
    db.prepare(
      `INSERT INTO knowledge (
        id, organisation_id, category, title, content, source, confidence, last_verified, created_at, updated_at,
        data_status, source_type, source_name, last_updated, context_type, effective_from, supersedes_id
      ) VALUES (?, ?, 'strategy', ?, ?, 'Hayden', 'high', ?, ?, ?, 'manual', 'hayden', 'Founder provided', ?, 'STRATEGY', ?, ?)`,
    ).run(id, input.organisationId ?? old.organisation_id, title, content, today, now, now, now, today, old.id);
    db.prepare(
      `UPDATE knowledge
       SET superseded_by_id = ?, effective_until = ?, context_type = 'HISTORICAL', updated_at = ?, last_updated = ?
       WHERE id = ?`,
    ).run(id, today, now, now, old.id);
  });
  apply();
  return id;
}

export function updateOrganisationStrategy(
  db: Database.Database,
  input: {
    id: string;
    strategicRole: string;
    strategicPriority: number;
    growthIntent: string;
    haydenRole: string;
    desiredHaydenInvolvement: string;
    businessModel: string;
    primaryObjective: string;
    timeHorizon: string;
  },
) {
  if (input.strategicPriority < 1 || input.strategicPriority > 5) throw new Error("Strategic priority is 1 to 5.");
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE organisations
       SET strategic_role = ?, strategic_priority = ?, growth_intent = ?, hayden_role = ?,
           desired_hayden_involvement = ?, business_model = ?, primary_objective = ?, time_horizon = ?,
           data_status = 'manual', source_type = 'hayden', source_name = 'Founder provided', last_updated = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      blank(input.strategicRole),
      input.strategicPriority,
      blank(input.growthIntent),
      blank(input.haydenRole),
      blank(input.desiredHaydenInvolvement),
      blank(input.businessModel),
      blank(input.primaryObjective),
      blank(input.timeHorizon),
      now,
      now,
      input.id,
    );
  if (result.changes === 0) throw new Error("That organisation is not in memory.");
}

export function updateKnowledgeRecord(
  db: Database.Database,
  input: { id: string; title: string; content: string; contextType: string; confidence: string },
) {
  if (!CONTEXT_TYPES.includes(input.contextType as ContextType)) throw new Error("That context type is not valid.");
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || !content) throw new Error("A record needs a title and content.");
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE knowledge
       SET title = ?, content = ?, context_type = ?, confidence = ?, source = 'Hayden',
           data_status = 'manual', source_type = 'hayden', source_name = 'Founder provided',
           last_verified = ?, last_updated = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(title, content, input.contextType, input.confidence.trim() || "medium", now.slice(0, 10), now, now, input.id);
  if (result.changes === 0) throw new Error("That record is not in memory.");
}

export function updatePersonContext(
  db: Database.Database,
  input: { id: string; role: string; responsibilities: string; notes: string },
) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE people
       SET role = ?, responsibilities = ?, notes = ?,
           data_status = 'manual', source_type = 'hayden', source_name = 'Founder provided', last_updated = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(blank(input.role), blank(input.responsibilities), blank(input.notes), now, now, input.id);
  if (result.changes === 0) throw new Error("That person is not in memory.");
}

export function saveOpenQuestion(
  db: Database.Database,
  input: { id?: string; question: string; why: string; organisationId: string | null; status: string },
) {
  const question = input.question.trim();
  if (!question) throw new Error("An open question needs the question.");
  if (!["open", "answered", "dismissed"].includes(input.status)) throw new Error("That question status is not valid.");
  const now = new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  db.prepare(
    `INSERT INTO open_questions (
      id, organisation_id, question, why_it_matters, status, data_status, source_type, source_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'manual', 'hayden', 'Founder provided', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      question = excluded.question,
      why_it_matters = excluded.why_it_matters,
      organisation_id = excluded.organisation_id,
      status = excluded.status,
      data_status = 'manual',
      source_name = 'Founder provided',
      updated_at = excluded.updated_at`,
  ).run(id, input.organisationId, question, blank(input.why), input.status, now, now);
  return id;
}

function blank(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}
