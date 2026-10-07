import type Database from "better-sqlite3";
import { resolveBrand } from "@/lib/visual/brand";

export type IntentLock = {
  id: string;
  concept_id: string;
  organisation_id: string | null;
  brand: string;
  format: string | null;
  visual_medium: string | null;
  core_device: string | null;
  humour_mechanism: string | null;
  character_concept: string | null;
  world_concept: string | null;
  required_motif: string | null;
  forbidden_changes: string | null;
  status: string;
};

type ConceptSlice = {
  id: string;
  organisation_id: string | null;
  brand: string | null;
  title: string;
  concept: string | null;
  hook: string | null;
  format: string | null;
  visual_direction: string | null;
  script_outline: string | null;
  why_it_may_work: string | null;
};

export function getIntent(db: Database.Database, conceptId: string) {
  return db.prepare(`SELECT * FROM creative_intent_locks WHERE concept_id = ?`).get(conceptId) as IntentLock | undefined;
}

export function lockIntent(db: Database.Database, conceptId: string) {
  const existing = getIntent(db, conceptId);
  if (existing?.status === "locked") return existing;
  const concept = db.prepare(`SELECT * FROM creative_concepts WHERE id = ?`).get(conceptId) as ConceptSlice | undefined;
  if (!concept) throw new Error("That concept is not stored.");
  const blob = `${concept.title} ${concept.concept ?? ""} ${concept.hook ?? ""} ${concept.format ?? ""} ${concept.visual_direction ?? ""} ${concept.script_outline ?? ""}`;
  const brand = resolveBrand(db, { organisationId: concept.organisation_id, text: blob, storedBrand: concept.brand });
  const medium = mediumFrom(blob);
  const sketch = /sketch|illustrat/i.test(medium);
  const now = new Date().toISOString();
  const row: IntentLock = {
    id: existing?.id ?? crypto.randomUUID(),
    concept_id: concept.id,
    organisation_id: brand.id,
    brand: brand.name,
    format: concept.format,
    visual_medium: medium,
    core_device: deviceFrom(blob),
    humour_mechanism: concept.why_it_may_work || "Character behaviour carries the joke. Do not add a random gag.",
    character_concept: "Keep the characters named in the approved concept. Do not recast them as generic presenters.",
    world_concept: concept.visual_direction,
    required_motif: motifFrom(blob),
    forbidden_changes: sketch
      ? "Do not convert this to generic photoreal live-action. Do not drop the split. Do not replace the joke with a finance explainer."
      : "Do not change the approved format, core device, or characters without a proposed creative deviation.",
    status: "locked",
  };
  db.prepare(
    `INSERT INTO creative_intent_locks (
      id, concept_id, organisation_id, brand, format, visual_medium, core_device, humour_mechanism,
      character_concept, world_concept, required_motif, forbidden_changes, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'locked', ?)
    ON CONFLICT(concept_id) DO UPDATE SET
      organisation_id = excluded.organisation_id,
      brand = excluded.brand,
      format = excluded.format,
      visual_medium = excluded.visual_medium,
      core_device = excluded.core_device,
      humour_mechanism = excluded.humour_mechanism,
      character_concept = excluded.character_concept,
      world_concept = excluded.world_concept,
      required_motif = excluded.required_motif,
      forbidden_changes = excluded.forbidden_changes,
      status = 'locked'`,
  ).run(
    row.id,
    row.concept_id,
    row.organisation_id,
    row.brand,
    row.format,
    row.visual_medium,
    row.core_device,
    row.humour_mechanism,
    row.character_concept,
    row.world_concept,
    row.required_motif,
    row.forbidden_changes,
    now,
  );
  if (brand.known && brand.id) {
    db.prepare(`UPDATE creative_concepts SET organisation_id = ?, brand = ? WHERE id = ?`).run(brand.id, brand.name, concept.id);
    db.prepare(`UPDATE production_packs SET organisation_id = COALESCE(organisation_id, ?), brand = ? WHERE creative_concept_id = ?`).run(brand.id, brand.name, concept.id);
  }
  return getIntent(db, conceptId)!;
}

export function proposeDeviation(db: Database.Database, conceptId: string, proposedBy: string, proposal: string) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO visual_deviations (id, concept_id, proposed_by, proposal, status, created_at) VALUES (?, ?, ?, ?, 'proposed', ?)`).run(
    crypto.randomUUID(),
    conceptId,
    proposedBy,
    proposal.trim(),
    now,
  );
  db.prepare(`UPDATE creative_intent_locks SET status = 'deviation_proposed' WHERE concept_id = ?`).run(conceptId);
}

function mediumFrom(text: string) {
  if (/sketch|illustrat/i.test(text)) return "Stylised illustrated / cinematic sketch";
  if (/clay/.test(text)) return "Claymation";
  if (/photoreal|live action|live-action/.test(text)) return "Photoreal";
  return "UNKNOWN MEDIUM";
}

function deviceFrom(text: string) {
  if (/split/i.test(text)) return "Left character visually frozen in time while the right character progresses through life.";
  return "Use the visual device described in the approved concept. Do not replace it.";
}

function motifFrom(text: string) {
  if (/split/i.test(text)) return "The split remains throughout.";
  if (/headline|news/i.test(text)) return "Headlines stay a visual device, not a lecture.";
  return "Keep the motif named in the approved concept.";
}
