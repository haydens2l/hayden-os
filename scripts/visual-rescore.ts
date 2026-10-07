import fs from "node:fs";
import Database from "better-sqlite3";
import { critiqueImage } from "../src/lib/visual/critic";
import { regenerateWithNote } from "../src/lib/visual/generate";

const packId = "0ce039f4-f6de-4f45-8639-2953f01f122d";
const conceptId = "d7e0039f-c49a-412a-aff8-1bef19500379";

type Frame = {
  id: string;
  scene_number: number | null;
  storage_location: string;
  mime_type: string | null;
  metadata: string | null;
  created_at: string;
};

async function main() {
  const db = new Database("data/hayden.db");
  db.pragma("journal_mode = WAL");
  const refs = db.prepare(`SELECT asset_id, MAX(sent) AS sent FROM generation_references GROUP BY asset_id`).all() as Array<{ asset_id: string; sent: number }>;
  for (const ref of refs) {
    const row = db.prepare(`SELECT metadata FROM generated_assets WHERE id = ?`).get(ref.asset_id) as { metadata: string | null };
    const meta = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {};
    if (ref.sent && meta.referencesSent !== 1) {
      meta.referencesSent = 1;
      db.prepare(`UPDATE generated_assets SET metadata = ? WHERE id = ?`).run(JSON.stringify(meta), ref.asset_id);
    }
  }

  const lock = db.prepare(`SELECT brand, visual_medium, core_device, required_motif, forbidden_changes FROM creative_intent_locks WHERE concept_id = ?`).get(conceptId) as {
    brand: string;
    visual_medium: string;
    core_device: string;
    required_motif: string;
    forbidden_changes: string;
  };
  const style = db.prepare(`SELECT style_name, style_description, negative_style_constraints FROM visual_style_profiles WHERE concept_id = ?`).get(conceptId) as {
    style_name: string;
    style_description: string;
    negative_style_constraints: string;
  };
  const briefFor = (extra: string) =>
    `Brand: ${lock.brand}. Medium: ${lock.visual_medium}. Style: ${style.style_name}. ${style.style_description}. Device: ${lock.core_device}. Required: ${lock.required_motif}. Forbidden: ${lock.forbidden_changes}. Negatives: ${style.negative_style_constraints}. ${extra} If the medium is a sketch and the image is photoreal, STYLE MATCH is FAIL. If a split is required and you cannot see a left/right split, COMPOSITION is FAIL.`;

  const old = db.prepare(`SELECT id, storage_location, mime_type FROM generated_assets WHERE production_pack_id = ? AND asset_role = 'STORYBOARD_FRAME' AND file_size > 0 AND created_at < '2026-10-05T05:20:00' ORDER BY created_at LIMIT 1`).get(packId) as
    | { id: string; storage_location: string; mime_type: string | null }
    | undefined;
  if (!old) throw new Error("The original storyboard frame is missing.");
  await score(db, old.id, old.storage_location, old.mime_type, briefFor("This is an earlier generation. Judge the pixels against the locked sketch."), null, "OLD");

  const latest = db.prepare(
    `SELECT a.id, s.scene_number, a.storage_location, a.mime_type, a.metadata, a.created_at
     FROM generated_assets a
     JOIN production_scenes s ON s.id = a.scene_id
     WHERE a.production_pack_id = ? AND a.asset_role = 'STORYBOARD_FRAME' AND a.file_size > 0 AND a.created_at > '2026-10-05T05:20:00'
       AND a.id = (
         SELECT a2.id FROM generated_assets a2
         WHERE a2.scene_id = a.scene_id AND a2.asset_role = 'STORYBOARD_FRAME' AND a2.file_size > 0 AND a2.created_at > '2026-10-05T05:20:00'
         ORDER BY a2.created_at DESC LIMIT 1
       )
     ORDER BY s.scene_number`,
  ).all(packId) as Frame[];

  let previous: Frame | null = null;
  for (const frame of latest) {
    const shot = db.prepare(`SELECT composition, continuity_dependency, visual_joke FROM shot_plans WHERE concept_id = ? AND scene_number = ?`).get(conceptId, frame.scene_number) as
      | { composition: string | null; continuity_dependency: string | null; visual_joke: string | null }
      | undefined;
    await score(
      db,
      frame.id,
      frame.storage_location,
      frame.mime_type,
      briefFor(`Scene ${frame.scene_number}. Required composition: ${shot?.composition ?? ""}. Joke: ${shot?.visual_joke ?? ""}. Intended change: ${shot?.continuity_dependency ?? "none"}.`),
      previous,
      `SCENE ${frame.scene_number}`,
    );
    previous = frame;
  }

  const rulesBefore = db.prepare(`SELECT COUNT(*) AS n FROM visual_rules WHERE status = 'approved'`).get() as { n: number };
  const scene4 = latest.find((frame) => frame.scene_number === 4);
  if (!scene4) throw new Error("Scene 4 is missing.");
  const childId = await regenerateWithNote(db, scene4.id, "Too corporate.");
  const child = db.prepare(`SELECT id, parent_asset_id, prompt, generation_status FROM generated_assets WHERE id = ?`).get(childId) as {
    id: string;
    parent_asset_id: string;
    prompt: string;
    generation_status: string;
  };
  const parent = db.prepare(`SELECT id, generation_status FROM generated_assets WHERE id = ?`).get(scene4.id) as { id: string; generation_status: string };
  const feedback = db.prepare(`SELECT note, category FROM visual_feedback WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1`).get(scene4.id) as { note: string; category: string };
  const rulesAfter = db.prepare(`SELECT COUNT(*) AS n FROM visual_rules WHERE status = 'approved'`).get() as { n: number };
  const suggested = db.prepare(`SELECT COUNT(*) AS n FROM visual_rules WHERE status = 'suggested' AND rule_key = 'prefer-stylised'`).get() as { n: number };
  console.log(
    "FEEDBACK",
    JSON.stringify({
      note: feedback.note,
      category: feedback.category,
      parentStatus: parent.generation_status,
      parentRemains: parent.id === scene4.id,
      childParent: child.parent_asset_id === scene4.id,
      noteInPrompt: child.prompt.includes("Too corporate."),
      approvedRulesBefore: rulesBefore.n,
      approvedRulesAfter: rulesAfter.n,
      suggestedFromOneNote: suggested.n,
    }),
  );
}

async function score(
  db: Database.Database,
  id: string,
  path: string,
  mime: string | null,
  brief: string,
  previous: Frame | null,
  label: string,
) {
  const images = [{ bytes: fs.readFileSync(path), mimeType: mime || "image/jpeg", label: "Generated image to judge." }];
  if (previous?.storage_location) {
    images.push({
      bytes: fs.readFileSync(previous.storage_location),
      mimeType: previous.mime_type || "image/jpeg",
      label: "Previous frame for continuity. Intended changes are in the brief. Do not fail a deliberate time jump.",
    });
  }
  const critique = await critiqueImage({ images, brief });
  db.prepare(`INSERT INTO visual_critiques (id, asset_id, model, scores, summary, regeneration_plan, visible_detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(),
    id,
    critique.model,
    JSON.stringify(critique.scores),
    critique.summary,
    critique.regenerationPlan,
    critique.visibleDetail,
    new Date().toISOString(),
  );
  const fails = Object.entries(critique.scores)
    .filter(([, score]) => score.result === "FAIL")
    .map(([name]) => name);
  const row = db.prepare(`SELECT metadata FROM generated_assets WHERE id = ?`).get(id) as { metadata: string | null };
  const meta = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {};
  meta.qa = critique.ok && fails.length === 0 ? "pass" : "unresolved";
  const sent = db.prepare(`SELECT MAX(sent) AS n FROM generation_references WHERE asset_id = ?`).get(id) as { n: number | null };
  if (sent.n) meta.referencesSent = 1;
  db.prepare(`UPDATE generated_assets SET metadata = ?, generation_status = 'NEEDS_HAYDEN', error_message = ? WHERE id = ?`).run(
    JSON.stringify(meta),
    critique.ok && fails.length === 0 ? null : critique.ok ? `${fails.join(", ")} failed. ${critique.summary}` : critique.message,
    id,
  );
  const style = critique.scores["STYLE MATCH"];
  const composition = critique.scores["COMPOSITION"];
  const continuity = critique.scores["CONTINUITY"];
  const character = critique.scores["CHARACTER CONSISTENCY"];
  console.log(
    label,
    JSON.stringify({
      ok: critique.ok,
      style: style?.result,
      styleEvidence: style?.evidence,
      composition: composition?.result,
      compositionEvidence: composition?.evidence,
      continuity: continuity?.result,
      character: character?.result,
      visible: critique.visibleDetail,
      fails,
      plan: critique.regenerationPlan,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
