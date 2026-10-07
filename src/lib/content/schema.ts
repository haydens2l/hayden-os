import type Database from "better-sqlite3";
import { STYLE_TEMPLATES } from "@/lib/content/styles";

export function ensureContentFactory(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_items (
      id TEXT PRIMARY KEY,
      organisation_id TEXT,
      brand TEXT,
      title TEXT,
      objective TEXT,
      audience TEXT,
      rough_idea TEXT,
      content_type TEXT,
      platform TEXT,
      duration_seconds INTEGER,
      reference_note TEXT,
      project_id TEXT,
      stage TEXT NOT NULL,
      waiting_on TEXT,
      owner TEXT,
      concept_id TEXT,
      legacy_pack_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_scripts (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      audio_mode TEXT,
      spoken TEXT,
      voiceover TEXT,
      on_screen TEXT,
      beats_json TEXT,
      structure_json TEXT,
      estimated_seconds INTEGER,
      quality_notes TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS script_locks (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      script_id TEXT NOT NULL,
      locked_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS style_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      family TEXT NOT NULL,
      status TEXT NOT NULL,
      approved_by TEXT,
      visual_medium TEXT,
      material_language TEXT,
      character_language TEXT,
      environment_language TEXT,
      realism_level TEXT,
      stylisation_level TEXT,
      texture TEXT,
      colour_philosophy TEXT,
      lighting_philosophy TEXT,
      camera_language TEXT,
      lens_language TEXT,
      depth_of_field TEXT,
      composition_language TEXT,
      motion_language TEXT,
      facial_expression_language TEXT,
      production_design TEXT,
      continuity_rules TEXT,
      prompt_recipe TEXT,
      negative_constraints TEXT,
      recommended_use TEXT,
      known_weaknesses TEXT,
      preferred_models TEXT,
      generation_notes TEXT,
      parent_style_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS style_references (
      id TEXT PRIMARY KEY,
      style_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      file_path TEXT,
      note TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS style_variants (
      id TEXT PRIMARY KEY,
      style_id TEXT NOT NULL,
      name TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS brand_style_preferences (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL,
      style_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      approved_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS style_locks (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      style_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      selected_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS storyboard_passes (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      pass_number INTEGER NOT NULL,
      kind TEXT NOT NULL,
      style_lock_id TEXT,
      script_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visual_locks (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      pass_id TEXT NOT NULL,
      script_id TEXT NOT NULL,
      style_lock_id TEXT NOT NULL,
      locked_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creative_change_requests (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS style_model_evidence (
      id TEXT PRIMARY KEY,
      style_id TEXT NOT NULL,
      model TEXT,
      outcome TEXT NOT NULL,
      reason TEXT,
      cost_usd REAL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_stage ON content_items(stage, updated_at);
  `);
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO style_templates (
      id, name, description, family, status, approved_by, visual_medium, material_language, character_language,
      environment_language, realism_level, stylisation_level, texture, colour_philosophy, lighting_philosophy,
      camera_language, lens_language, depth_of_field, composition_language, motion_language, facial_expression_language,
      production_design, continuity_rules, prompt_recipe, negative_constraints, recommended_use, known_weaknesses,
      preferred_models, generation_notes, parent_style_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'approved', 'hayden', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
  );
  const reference = db.prepare(
    `INSERT INTO style_references (id, style_id, purpose, file_path, note, status, created_at)
     SELECT ?, ?, 'STYLE', NULL, 'Approved reference from the style review has not been imported.', 'required', ?
     WHERE NOT EXISTS (SELECT 1 FROM style_references WHERE style_id = ?)`,
  );
  for (const style of STYLE_TEMPLATES) {
    insert.run(
      style.id,
      style.name,
      style.description,
      style.family,
      style.visualMedium,
      style.material,
      style.characters,
      style.environment,
      style.realism,
      style.stylisation,
      style.texture,
      style.colour,
      style.lighting,
      style.camera,
      style.lens,
      style.depth,
      style.composition,
      style.motion,
      style.faces,
      style.production,
      style.continuity,
      style.recipe,
      style.negative,
      style.use,
      style.weaknesses,
      now,
      now,
    );
    reference.run(`${style.id}-ref`, style.id, now, style.id);
  }
  const packs = db.prepare(
    `SELECT p.id, p.brand, p.organisation_id, p.creative_concept_id, p.created_at, c.title AS concept_title
     FROM production_packs p
     LEFT JOIN creative_concepts c ON c.id = p.creative_concept_id`,
  ).all() as Array<{
    id: string;
    brand: string | null;
    organisation_id: string | null;
    creative_concept_id: string | null;
    created_at: string;
    concept_title: string | null;
  }>;
  const legacy = db.prepare(
    `INSERT INTO content_items (
      id, organisation_id, brand, title, rough_idea, stage, waiting_on, owner, concept_id, legacy_pack_id, created_at, updated_at
    ) SELECT ?, ?, ?, ?, 'Existing production pack. Stage was not reconstructed.', 'LEGACY', 'Legacy pack. No script lock or visual lock was invented.', 'unassigned', ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM content_items WHERE legacy_pack_id = ?)`,
  );
  for (const pack of packs) {
    legacy.run(crypto.randomUUID(), pack.organisation_id, pack.brand, pack.concept_title || pack.brand || "Legacy pack", pack.creative_concept_id, pack.id, pack.created_at, now, pack.id);
  }
}
