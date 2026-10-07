import fs from "node:fs";
import Database from "better-sqlite3";
import { critiqueImage, failedDimensions } from "../src/lib/visual/critic";

const scene6 = "2ac96286-9251-4d61-b9f3-27fd609e2f61";
const conceptId = "d7e0039f-c49a-412a-aff8-1bef19500379";

async function main() {
  const db = new Database("data/hayden.db");
  db.pragma("journal_mode = WAL");
  const frame = db.prepare(`SELECT storage_location, mime_type, metadata FROM generated_assets WHERE id = ?`).get(scene6) as {
    storage_location: string;
    mime_type: string | null;
    metadata: string | null;
  };
  const previous = db.prepare(
    `SELECT a.storage_location, a.mime_type
     FROM generated_assets a
     JOIN production_scenes s ON s.id = a.scene_id
     WHERE s.scene_number = 5 AND a.asset_role = 'STORYBOARD_FRAME' AND a.file_size > 0 AND a.created_at > '2026-10-05T05:20:00'
     ORDER BY a.created_at DESC LIMIT 1`,
  ).get() as { storage_location: string; mime_type: string | null } | undefined;
  const shot = db.prepare(`SELECT composition, continuity_dependency, visual_joke FROM shot_plans WHERE concept_id = ? AND scene_number = 6`).get(conceptId) as {
    composition: string | null;
    continuity_dependency: string | null;
    visual_joke: string | null;
  };
  const critique = await critiqueImage({
    images: [
      { bytes: fs.readFileSync(frame.storage_location), mimeType: frame.mime_type || "image/png", label: "Scene 6. Judge this image." },
      ...(previous
        ? [{ bytes: fs.readFileSync(previous.storage_location), mimeType: previous.mime_type || "image/jpeg", label: "Previous frame. Match identity, wardrobe, world, and side. Allow gaze, expression, hands, and posture to change." }]
        : []),
    ],
    brief: `Brand: Property Made Simple. Medium: Stylised illustrated / cinematic sketch. Style: Tactile editorial sketch. Device: the left character is stuck in the same life while the right character's life progresses. Required: the split remains. He may react, move his phone, change expression, and shift on the couch. Same man, same shirt, same lounge, same blue night, same left side. Composition: ${shot.composition ?? ""}. Joke: ${shot.visual_joke ?? ""}. Shot-plan continuity note: ${shot.continuity_dependency ?? ""}. That note does not freeze his exact pose.`,
  });
  db.prepare(`INSERT INTO visual_critiques (id, asset_id, model, scores, summary, regeneration_plan, visible_detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(),
    scene6,
    critique.model,
    JSON.stringify(critique.scores),
    critique.summary,
    critique.regenerationPlan,
    critique.visibleDetail,
    new Date().toISOString(),
  );
  const fails = failedDimensions(critique.scores);
  const meta = frame.metadata ? (JSON.parse(frame.metadata) as Record<string, unknown>) : {};
  meta.qa = critique.ok && fails.length === 0 ? "pass" : "unresolved";
  db.prepare(`UPDATE generated_assets SET metadata = ?, generation_status = 'NEEDS_HAYDEN', error_message = ? WHERE id = ?`).run(
    JSON.stringify(meta),
    critique.ok && fails.length === 0 ? null : critique.ok ? `${fails.join(", ")} failed. ${critique.summary}` : critique.message,
    scene6,
  );
  const interesting = ["CREATIVE INTENT MATCH", "CHARACTER CONSISTENCY", "CONTINUITY", "STYLE MATCH", "COMPOSITION", "ENVIRONMENT CONSISTENCY"];
  console.log(JSON.stringify({
    ok: critique.ok,
    message: critique.message,
    fails,
    summary: critique.summary,
    visible: critique.visibleDetail,
    scores: Object.fromEntries(interesting.map((name) => [name, critique.scores[name]])),
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
