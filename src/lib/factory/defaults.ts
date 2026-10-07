import type Database from "better-sqlite3";

const PROFILES: Array<[string, string, string]> = [
  ["profile-omni-flash", "omni-flash", "Omni Flash"],
  ["profile-veo", "veo", "Veo"],
  ["profile-kling", "kling", "Kling"],
  ["profile-other", "other", "Other"],
];

const RULES: Array<[string, string, string, string]> = [
  [
    "rule-entertainment",
    "entertainment-first",
    "Entertainment first",
    "Entertainment first. Prefer story, comedy, tension, surprise, characters, visual metaphor or comparison over a dry explainer, where that suits the brand.",
  ],
  [
    "rule-continuity",
    "scene-continuity",
    "Scene continuity",
    "For AI video, prioritise smooth scene continuity. The end frame of a scene should support the start frame of the next.",
  ],
  [
    "rule-surfaces",
    "information-surfaces",
    "Information surfaces",
    "Do not unnaturally present phones, documents, payslips, calculators, statements or other information surfaces at camera so the audience can read them. Point props toward the character using them. Put important information in voiceover, on-screen text, a clean graphic insert, or a later dedicated shot.",
  ],
  [
    "rule-logos",
    "no-automatic-logos",
    "Logos",
    "Do not automatically place logos in final frames.",
  ],
  [
    "rule-bubbles",
    "no-speech-bubbles",
    "Speech bubbles",
    "Do not automatically use speech bubbles.",
  ],
];

export function ensureProductionDefaults(db: Database.Database) {
  const now = new Date().toISOString();
  const profile = db.prepare(
    `INSERT INTO production_model_profiles (
      id, slug, name, allowed_durations, prompt_style, start_end_frames, audio_support, dialogue_support, aspect_ratios, known_limitations, notes, created_at
    ) VALUES (?, ?, ?, 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', ?, ?)
    ON CONFLICT(id) DO NOTHING`,
  );
  for (const [id, slug, name] of PROFILES) {
    profile.run(id, slug, name, "Name only. Technical capabilities are not verified.", now);
  }
  const rule = db.prepare(
    `INSERT INTO production_rules (
      id, rule_key, scope, title, body, source_type, source_name, created_at
    ) VALUES (?, ?, 'global', ?, ?, 'manual', 'Founder provided', ?)
    ON CONFLICT(id) DO NOTHING`,
  );
  for (const [id, key, title, body] of RULES) rule.run(id, key, title, body, now);
}

export function activeRules(
  db: Database.Database,
  scope: { organisationId?: string | null; projectId?: string | null; modelProfileId?: string | null },
) {
  const rows = db
    .prepare(
      `SELECT id, rule_key, scope, organisation_id, project_id, model_profile_id, title, body
       FROM production_rules WHERE superseded_by_id IS NULL`,
    )
    .all() as Array<{
    id: string;
    rule_key: string;
    scope: string;
    organisation_id: string | null;
    project_id: string | null;
    model_profile_id: string | null;
    title: string;
    body: string;
  }>;
  const rank: Record<string, number> = { global: 0, brand: 1, project: 2, model: 3 };
  const chosen = new Map<string, (typeof rows)[number]>();
  const applicable = rows
    .filter((row) => {
      if (row.scope === "global") return true;
      if (row.scope === "brand") return row.organisation_id === scope.organisationId;
      if (row.scope === "project") return row.project_id != null && row.project_id === scope.projectId;
      if (row.scope === "model") return row.model_profile_id != null && row.model_profile_id === scope.modelProfileId;
      return false;
    })
    .sort((a, b) => (rank[a.scope] ?? 0) - (rank[b.scope] ?? 0));
  for (const row of applicable) chosen.set(row.rule_key, row);
  return [...chosen.values()];
}

export function supersedeRule(db: Database.Database, ruleId: string, body: string) {
  const current = db.prepare(`SELECT * FROM production_rules WHERE id = ?`).get(ruleId) as
    | {
        rule_key: string;
        scope: string;
        organisation_id: string | null;
        project_id: string | null;
        model_profile_id: string | null;
        title: string;
        source_type: string;
        source_name: string;
      }
    | undefined;
  if (!current) throw new Error("That production rule is not stored.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO production_rules (
      id, rule_key, scope, organisation_id, project_id, model_profile_id, title, body, source_type, source_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'Hayden', ?)`,
  ).run(id, current.rule_key, current.scope, current.organisation_id, current.project_id, current.model_profile_id, current.title, body.trim(), now);
  db.prepare(`UPDATE production_rules SET superseded_by_id = ? WHERE id = ?`).run(id, ruleId);
  return id;
}
