import fs from "node:fs";
import Database from "better-sqlite3";
import { compileFramePrompt } from "../src/lib/visual/compiler";
import { critiqueImage } from "../src/lib/visual/critic";
import { runVisualDirector } from "../src/lib/visual/director";
import { runIntelligentStoryboard } from "../src/lib/visual/generate";
import { getIntent, lockIntent } from "../src/lib/visual/intent";
import { ensureVisualIntelligence } from "../src/lib/visual/schema";

const conceptId = "d7e0039f-c49a-412a-aff8-1bef19500379";
const packId = "0ce039f4-f6de-4f45-8639-2953f01f122d";

async function main() {
  const db = new Database("data/hayden.db");
  db.pragma("journal_mode = WAL");
  ensureVisualIntelligence(db);
  db.prepare(`UPDATE creative_concepts SET organisation_id = ?, brand = ? WHERE id = ?`).run("property-made-simple", "Property Made Simple", conceptId);
  db.prepare(`UPDATE production_packs SET organisation_id = ?, brand = ? WHERE id = ?`).run("property-made-simple", "Property Made Simple", packId);
  const locked = lockIntent(db, conceptId);
  console.log("INTENT", JSON.stringify({ brand: locked.brand, medium: locked.visual_medium, device: locked.core_device, motif: locked.required_motif, forbidden: locked.forbidden_changes }));
  const directed = await runVisualDirector(db, conceptId, null);
  console.log("DIRECTOR", directed.summary);
  const style = db.prepare(`SELECT * FROM visual_style_profiles WHERE concept_id = ?`).get(conceptId) as {
    visual_medium: string;
    style_name: string;
    style_description: string;
    texture: string;
    colour_philosophy: string;
    lighting_philosophy: string;
    camera_language: string;
    lens_language: string;
    composition_language: string;
    character_design: string;
    negative_style_constraints: string;
    humour_language: string;
  };
  const shot = db.prepare(`SELECT * FROM shot_plans WHERE concept_id = ? AND scene_number = 1`).get(conceptId) as {
    scene_number: number;
    role: string;
    story_purpose: string;
    visual_joke: string;
    subject: string;
    action: string;
    composition: string;
    camera_position: string;
    camera_height: string;
    shot_size: string;
    lens_feeling: string;
    lighting: string;
    colour: string;
    environment: string;
    props: string;
    expression: string;
    readable: string;
    continuity_dependency: string;
    must_not_appear: string;
  };
  const prompt = compileFramePrompt({
    brand: locked.brand,
    purpose: shot.story_purpose,
    style,
    shot,
    continuity: shot.continuity_dependency,
    referenceNote: "A character reference will be attached.",
    rules: ["The property point comes through the joke, not a lecture."],
  });
  console.log("PROMPT_LENGTH", prompt.length);
  console.log("PROMPT_START", prompt.slice(0, 1200));
  console.log("PROMPT_HAS_JSON", prompt.includes("{"));
  console.log("PROMPT_HAS_REAL_LIGHT", /real homes, real light/i.test(prompt));
  const old = db.prepare(`SELECT storage_location, mime_type FROM generated_assets WHERE production_pack_id = ? AND asset_role = 'STORYBOARD_FRAME' AND file_size > 0 ORDER BY created_at LIMIT 1`).get(packId) as
    | { storage_location: string; mime_type: string }
    | undefined;
  if (old?.storage_location) {
    const bytes = fs.readFileSync(old.storage_location);
    const critique = await critiqueImage({
      images: [{ bytes, mimeType: old.mime_type || "image/jpeg", label: "Existing storyboard frame. Judge the pixels." }],
      brief: `Brand: Property Made Simple. Medium: ${locked.visual_medium}. Style: ${style.style_name}. ${style.style_description} Required: split screen. Forbidden: photoreal live-action. If this image is a photograph, STYLE MATCH is FAIL.`,
    });
    console.log("OLD_STYLE", JSON.stringify(critique.scores["STYLE MATCH"]));
    console.log("OLD_VISIBLE", critique.visibleDetail);
    console.log("OLD_PLAN", critique.regenerationPlan);
  }
  const again = getIntent(db, conceptId);
  console.log("BRAND_STILL", again?.brand, again?.visual_medium);
  const generated = await runIntelligentStoryboard(db, packId);
  console.log("GENERATED", JSON.stringify(generated));
  const refs = db.prepare(`SELECT purpose, sent, COUNT(*) AS n FROM generation_references GROUP BY purpose, sent`).all();
  console.log("REFS", JSON.stringify(refs));
  db.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
