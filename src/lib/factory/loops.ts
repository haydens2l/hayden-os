import type Database from "better-sqlite3";
import { requestHandoff } from "@/lib/team/work";

const CREATIVE_REASONS = ["concept issue", "hook issue", "script issue", "format issue", "production infeasibility"] as const;

export async function returnToCreative(db: Database.Database, packId: string, reason: string) {
  const pack = db.prepare(`SELECT id, creative_concept_id, brand, job_id FROM production_packs WHERE id = ?`).get(packId) as
    | { id: string; creative_concept_id: string | null; brand: string | null; job_id: string | null }
    | undefined;
  if (!pack) throw new Error("That production pack is not stored.");
  const clean = CREATIVE_REASONS.find((item) => item === reason) ?? "production infeasibility";
  const concept = pack.creative_concept_id
    ? (db.prepare(`SELECT title, concept FROM creative_concepts WHERE id = ?`).get(pack.creative_concept_id) as { title: string; concept: string | null } | undefined)
    : undefined;
  const before = concept?.concept ?? "";
  const result = await requestHandoff(db, {
    fromAgentId: "content",
    toAgentId: "creative",
    fromJobId: pack.job_id,
    objective: `Return to Creative Director. Reason: ${clean}. Brand: ${pack.brand ?? "Unassigned"}. Concept: ${concept?.title ?? "Unknown"}. The production pack cannot carry this as written. Do not treat the pack as a new strategy. concept:${pack.creative_concept_id ?? "none"}`,
  });
  const after = pack.creative_concept_id
    ? (db.prepare(`SELECT concept FROM creative_concepts WHERE id = ?`).get(pack.creative_concept_id) as { concept: string | null } | undefined)?.concept ?? ""
    : before;
  if (after !== before) throw new Error("Content Factory changed the concept while returning it.");
  return result;
}

export async function sendInsightToMedia(db: Database.Database, packId: string, insight: string) {
  const pack = db.prepare(`SELECT brand, production_type, job_id FROM production_packs WHERE id = ?`).get(packId) as
    | { brand: string | null; production_type: string; job_id: string | null }
    | undefined;
  if (!pack) throw new Error("That production pack is not stored.");
  return requestHandoff(db, {
    fromAgentId: "content",
    toAgentId: "media",
    fromJobId: pack.job_id,
    objective: `Production insight for Media Director. A repeatable format may be emerging from ${pack.brand ?? "this brand"} (${pack.production_type}). ${insight.trim()} Decide whether it should become a format idea. Do not mark it active.`,
  });
}
