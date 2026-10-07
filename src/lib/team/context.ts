import type Database from "better-sqlite3";
import { retrieveKnowledge } from "@/lib/integrations/google-drive/retrieve";

export function operatingContext(db: Database.Database, query: string, organisationId: string | null) {
  const retrieved = retrieveKnowledge(db, { query, organisationId, limit: 2 });
  const org = organisationId
    ? (db.prepare(`SELECT id, name, parent_id, primary_objective, business_model, notes FROM organisations WHERE id = ?`).get(organisationId) as
        | { id: string; name: string; parent_id: string | null; primary_objective: string | null; business_model: string | null; notes: string | null }
        | undefined)
    : undefined;
  const scope = [organisationId, org?.parent_id].filter((id): id is string => Boolean(id));
  const notes = scope.length
    ? (db
        .prepare(
          `SELECT context_type, title, content FROM knowledge
           WHERE organisation_id IN (${scope.map(() => "?").join(", ")})
             AND superseded_by_id IS NULL
             AND context_type != 'HISTORICAL'
           ORDER BY updated_at DESC
           LIMIT 8`,
        )
        .all(...scope) as Array<{ context_type: string; title: string; content: string }>)
    : retrieved.brain.slice(0, 6).map((item) => ({ context_type: item.context_type, title: item.title, content: item.content }));
  const noteLines = notes.map((item) => `${item.context_type}: ${item.title}. ${item.content}`.slice(0, 700));
  const documents = retrieved.excerpts
    .filter((item) => !organisationId || item.file.organisation_id === organisationId || !item.file.organisation_id)
    .map((item) => `${item.file.name}: ${item.excerpt}`.slice(0, 400));
  const packed = [
    org
      ? `Organisation: ${org.name}. Stay on this brand. Do not borrow another brand's audience, offer, or creative rules. Objective: ${org.primary_objective ?? "None stored"}. Model: ${org.business_model ?? "None stored"}.`
      : "No single organisation was detected. Say so if the brand is unclear.",
    noteLines.length > 0 ? `Business brain for this organisation:\n${noteLines.join("\n")}` : "No current Business brain note is stored for this organisation.",
    documents.length > 0 ? `Drive excerpts:\n${documents.join("\n")}` : "No Drive excerpt was retrieved.",
  ].join("\n\n");
  return {
    organisationName: org?.name ?? null,
    text: packed.slice(0, 6000),
    brainTitles: notes.map((item) => item.title),
  };
}
