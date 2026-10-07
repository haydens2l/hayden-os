import type Database from "better-sqlite3";

export function ensureVisualIntelligence(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS visual_rules (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      organisation_id TEXT,
      project_id TEXT,
      format_key TEXT,
      rule_key TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_name TEXT,
      status TEXT NOT NULL,
      confidence TEXT,
      approved_by TEXT,
      created_at TEXT NOT NULL,
      superseded_by_id TEXT
    );
    CREATE TABLE IF NOT EXISTS creative_intent_locks (
      id TEXT PRIMARY KEY,
      concept_id TEXT NOT NULL UNIQUE,
      organisation_id TEXT,
      brand TEXT NOT NULL,
      format TEXT,
      visual_medium TEXT,
      core_device TEXT,
      humour_mechanism TEXT,
      character_concept TEXT,
      world_concept TEXT,
      required_motif TEXT,
      forbidden_changes TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visual_deviations (
      id TEXT PRIMARY KEY,
      concept_id TEXT NOT NULL,
      proposed_by TEXT NOT NULL,
      proposal TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visual_style_profiles (
      id TEXT PRIMARY KEY,
      concept_id TEXT NOT NULL,
      visual_medium TEXT,
      style_name TEXT,
      style_description TEXT,
      reference_family TEXT,
      realism_level TEXT,
      stylisation_level TEXT,
      texture TEXT,
      colour_philosophy TEXT,
      lighting_philosophy TEXT,
      contrast TEXT,
      camera_language TEXT,
      lens_language TEXT,
      composition_language TEXT,
      character_design TEXT,
      environment_design TEXT,
      production_design TEXT,
      motion_language TEXT,
      humour_language TEXT,
      visual_metaphors TEXT,
      graphic_elements TEXT,
      typography_usage TEXT,
      continuity_strategy TEXT,
      reference_strategy TEXT,
      negative_style_constraints TEXT,
      locked INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visual_directions (
      id TEXT PRIMARY KEY,
      concept_id TEXT NOT NULL,
      job_id TEXT,
      thesis TEXT,
      world_bible TEXT,
      character_bible TEXT,
      shot_language TEXT,
      visual_story_arc TEXT,
      humour_test TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shot_plans (
      id TEXT PRIMARY KEY,
      concept_id TEXT NOT NULL,
      scene_number INTEGER NOT NULL,
      role TEXT,
      story_purpose TEXT,
      visual_joke TEXT,
      subject TEXT,
      action TEXT,
      composition TEXT,
      foreground TEXT,
      midground TEXT,
      background TEXT,
      camera_position TEXT,
      camera_height TEXT,
      shot_size TEXT,
      lens_feeling TEXT,
      lighting TEXT,
      colour TEXT,
      environment TEXT,
      props TEXT,
      expression TEXT,
      readable TEXT,
      continuity_dependency TEXT,
      references_required TEXT,
      must_not_appear TEXT,
      mute_test TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visual_critiques (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      model TEXT,
      scores TEXT NOT NULL,
      summary TEXT,
      regeneration_plan TEXT,
      visible_detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visual_anchors (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      concept_id TEXT,
      organisation_id TEXT,
      brand TEXT,
      kind TEXT NOT NULL,
      subject TEXT,
      liked TEXT,
      reuse TEXT,
      status TEXT NOT NULL,
      approved_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generation_references (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      reference_asset_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      provider TEXT,
      sent INTEGER NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visual_feedback (
      id TEXT PRIMARY KEY,
      asset_id TEXT,
      concept_id TEXT,
      organisation_id TEXT,
      brand TEXT,
      style_name TEXT,
      model TEXT,
      note TEXT NOT NULL,
      category TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_conflicts (
      id TEXT PRIMARY KEY,
      pack_id TEXT,
      concept_id TEXT,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visual_settings (
      id TEXT PRIMARY KEY,
      auto_regen INTEGER NOT NULL,
      max_retries INTEGER NOT NULL,
      hero_candidates INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visual_model_profiles (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      text_to_image INTEGER NOT NULL,
      image_references INTEGER NOT NULL,
      reference_limit INTEGER,
      aspect_ratios TEXT,
      resolutions TEXT,
      quality_controls TEXT,
      known_cost TEXT,
      limitations TEXT,
      verified_on TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agents (id, slug, name, mandate, organisation_id, status, created_at)
     SELECT 'visual', 'visual', 'Visual Director', ?, 'media-empire', 'active', ?
     WHERE NOT EXISTS (SELECT 1 FROM agents WHERE id = 'visual')`,
  ).run(
    "Own what the idea should look and feel like. Art direction, shot plan, and visual consistency. Cannot publish, send, or spend. Cannot silently change an approved concept.",
    now,
  );
  const grant = db.prepare(
    `INSERT INTO agent_permissions (id, agent_id, resource, level, requires_approval, notes)
     SELECT ?, 'visual', ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM agent_permissions WHERE agent_id = 'visual' AND resource = ? AND level = ?)`,
  );
  grant.run("visual-read", "*", "READ", 0, "Can read the concept, brand visual rules, and approved references.", "*", "READ");
  grant.run("visual-direction", "visual_directions", "CREATE", 0, "Can store a visual direction. It is not a finished image.", "visual_directions", "CREATE");
  grant.run("visual-publish", "publish_content", "EXECUTE", 1, "Cannot publish.", "publish_content", "EXECUTE");
  grant.run("visual-spend", "spend", "EXECUTE", 1, "Cannot spend.", "spend", "EXECUTE");
  db.prepare(`INSERT INTO visual_settings (id, auto_regen, max_retries, hero_candidates) SELECT 'hayden', 1, 2, 1 WHERE NOT EXISTS (SELECT 1 FROM visual_settings WHERE id = 'hayden')`).run();
  const rule = db.prepare(
    `INSERT INTO visual_rules (
      id, scope, organisation_id, rule_key, title, body, source_type, source_name, status, confidence, approved_by, created_at
    ) SELECT ?, 'brand', 'property-made-simple', ?, ?, ?, 'founder', 'Hayden', 'approved', 'high', 'hayden', ?
     WHERE NOT EXISTS (SELECT 1 FROM visual_rules WHERE id = ?)`,
  );
  const pms: Array<[string, string, string, string]> = [
    ["pms-entertainment", "entertainment-first", "Entertainment first", "The visual should feel like entertainment before education. The property or finance point comes through story, comedy, tension, comparison, surprise, character behaviour, or a visual metaphor."],
    ["pms-avoid-generic", "avoid-generic-finance", "Avoid generic finance advertising", "Avoid generic corporate imagery, people smiling at camera holding documents, stock-photo adviser scenes, calculator hero shots, phones or contracts facing camera, fake dashboards, random charts, corporate offices unless the concept needs them, and overly polished bank-ad aesthetics."],
    ["pms-no-lockups", "no-lockups", "No automatic lockups", "Do not automatically use logos, speech bubbles, or brand lockups."],
    ["pms-muted", "readable-muted", "Readable with the sound off", "The image should communicate the scene with the audio muted. Important props sit naturally in the world. The frame should look designed, not merely generated."],
  ];
  for (const [id, key, title, body] of pms) rule.run(id, key, title, body, now, id);
  db.prepare(
    `INSERT INTO visual_model_profiles (
      id, provider, model, text_to_image, image_references, reference_limit, aspect_ratios, resolutions, quality_controls, known_cost, limitations, verified_on
    ) SELECT 'xai-grok-imagine-image-2', 'xai', 'grok-imagine-image-2.0', 1, 1, 1,
      '1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 19.5:9, 9:19.5, 20:9, 9:20, 21:9, 5:2, auto',
      '1k, 2k',
      'low, medium, auto. There is no high setting on grok-imagine-image-2.0.',
      '$0.04 per image on the xAI rate card verified 2026-09-28. Quality and resolution are billed by what is served. A separate tier price was not on that card, so Hayden OS does not invent one.',
      'Hayden OS sends one reference image on the edit endpoint. Public docs describe more inputs. That larger limit is not treated as verified here. Character identity is not guaranteed.',
      '2026-10-05'
     WHERE NOT EXISTS (SELECT 1 FROM visual_model_profiles WHERE id = 'xai-grok-imagine-image-2')`,
  ).run();
  db.prepare(
    `INSERT INTO visual_model_profiles (
      id, provider, model, text_to_image, image_references, reference_limit, aspect_ratios, resolutions, quality_controls, known_cost, limitations, verified_on
    ) SELECT 'xai-grok-4-6-vision', 'xai', 'grok-4.6', 0, 0, NULL,
      NULL, NULL, NULL,
      'Text input $2 / 1M tokens and output $6 / 1M tokens under 200k, from the grok-4.6 model page.',
      'Modalities verified on the grok-4.6 page: text and image input, text output. Used as the Visual Critic. It does not generate the storyboard image.',
      '2026-10-05'
     WHERE NOT EXISTS (SELECT 1 FROM visual_model_profiles WHERE id = 'xai-grok-4-6-vision')`,
  ).run();
}
