import fs from "node:fs";
import Database from "better-sqlite3";
import { insertAsset, nextVersion, updateAsset } from "../src/lib/executor/assets";
import { imageListPrice } from "../src/lib/executor/pricing";
import { imageProvider } from "../src/lib/executor/providers";
import { localAssetStorage, sniffImage } from "../src/lib/executor/storage";
import { compileFramePrompt, type StyleProfile } from "../src/lib/visual/compiler";
import { critiqueImage, failedDimensions } from "../src/lib/visual/critic";
import { recordVisualFeedback } from "../src/lib/visual/generate";

const conceptId = "d7e0039f-c49a-412a-aff8-1bef19500379";
const packId = "0ce039f4-f6de-4f45-8639-2953f01f122d";
const oldScene1 = "e733c81a-d5ae-49dc-9d8e-271d18bb6da8";

async function main() {
  const db = new Database("data/hayden.db");
  db.pragma("journal_mode = WAL");
  recordVisualFeedback(db, oldScene1, "Still don't like the output. It looks like a pretty webtoon couple, not two mates and a joke.");

  db.prepare(
    `UPDATE visual_style_profiles SET
      style_description = 'Rough ink-and-paper editorial sketch. Uneven line, paper grain, handmade. Not a polished digital illustration.',
      texture = 'Visible paper, ink line, imperfect drawing',
      character_design = 'Two ordinary Australian men, early thirties, different faces and builds. Not models. Left wears a crumpled t-shirt and looks like he has been on the couch too long. Right is his mate, work boots, already living in the house. Not a couple. Not a woman. Not beautiful.',
      humour_language = 'The joke is visible with the sound off. Left is mid-excuse at the news. Right is already getting on with the house. Headlines are paper planes bouncing off a rising line.',
      negative_style_constraints = 'No anime. No webtoon. No big eyes. No pretty couple. No scarf costume. No smooth digital painting. No romantic lighting. No plastic skin. No photoreal live-action. No glossy bank-ad look. No literal airplane.'
     WHERE concept_id = ?`,
  ).run(conceptId);

  db.prepare(
    `UPDATE shot_plans SET
      subject = 'Left: an ordinary Australian man sunk in his couch. Right: his mate, a different ordinary man, already at the front door.',
      action = 'Left is mid-sentence at the telly, mouth open. Right jingles the house keys with one foot already inside.',
      expression = 'Left defensive and talking. Right unbothered. Not wistful. Not romantic.',
      props = 'Remote, telly glow, crumpled shirt. Keys and a cardboard box. Centre: a crude rising line and two paper planes, like headlines, bouncing off the line.',
      visual_joke = 'Same second. He is still talking to the news. His mate already has the keys.',
      must_not_appear = 'Anime, webtoon, pretty faces, a woman as the buyer, scarf, clipboard, airplane, plastic skin, glossy illustration.'
     WHERE concept_id = ? AND scene_number = 1`,
  ).run(conceptId);

  const style = db.prepare(`SELECT * FROM visual_style_profiles WHERE concept_id = ?`).get(conceptId) as StyleProfile;
  const shot = db.prepare(`SELECT * FROM shot_plans WHERE concept_id = ? AND scene_number = 1`).get(conceptId) as Parameters<typeof compileFramePrompt>[0]["shot"];
  const scene = db.prepare(`SELECT id FROM production_scenes WHERE pack_id = ? AND scene_number = 1`).get(packId) as { id: string };
  const prompt = compileFramePrompt({
    brand: "Property Made Simple",
    purpose: "Hook. He is already mid-excuse. His mate is already holding the keys. The joke has to read with the sound off.",
    style,
    shot,
    continuity: "First frame. No previous pose to copy.",
    referenceNote: "No reference image. Do not inherit a pretty illustrated couple.",
    rules: ["The property point comes through the joke, not a lecture."],
  });

  const id = crypto.randomUUID();
  insertAsset(db, {
    id,
    packId,
    sceneId: scene.id,
    conceptId,
    organisationId: "property-made-simple",
    projectId: null,
    role: "STORYBOARD_FRAME",
    prompt,
    aspectRatio: "9:16",
    parentId: oldScene1,
    version: nextVersion(db, oldScene1),
    status: "GENERATING",
    metadata: { qualityMode: "hero", apiQuality: "medium", resolution: "2k", attempt: 1, referencesSent: 0 },
  });
  const provider = imageProvider();
  const result = await provider.generate({ prompt, aspectRatio: "9:16", references: [], quality: "medium", resolution: "2k" });
  if (!result.ok) throw new Error(result.message);
  const sniffed = sniffImage(result.bytes);
  const stored = localAssetStorage().write(id, result.bytes, sniffed.mimeType);
  const price = imageListPrice(result.model, false);
  updateAsset(db, id, {
    status: "AI_QA",
    provider: provider.id,
    model: result.model,
    width: result.width ?? sniffed.width,
    height: result.height ?? sniffed.height,
    storageLocation: stored.absolutePath,
    fileName: stored.fileName,
    mimeType: stored.mimeType,
    fileSize: stored.fileSize,
    completedAt: new Date().toISOString(),
    metadata: { qualityMode: "hero", apiQuality: "medium", resolution: "2k", attempt: 1, referencesSent: 0, costUsd: price.costUsd, costBasis: price.costBasis },
  });
  const critique = await critiqueImage({
    images: [{ bytes: result.bytes, mimeType: stored.mimeType, label: "New Scene 1. Judge the pixels." }],
    brief: "Brand: Property Made Simple. Medium: rough ink-and-paper editorial sketch, not anime or webtoon. Two ordinary Australian men. Left mid-excuse on the couch. Right mate already has the keys. Split must be visible. Paper planes and a rising line should be in the middle. FAIL STYLE MATCH if it is a smooth pretty digital illustration or a romantic couple. FAIL CREATIVE INTENT if the right figure is a woman or the joke is just two people looking thoughtful.",
  });
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
  const fails = failedDimensions(critique.scores);
  updateAsset(db, id, {
    status: "NEEDS_HAYDEN",
    errorMessage: fails.length ? `${fails.join(", ")} failed. ${critique.summary}` : null,
    metadata: { qualityMode: "hero", apiQuality: "medium", resolution: "2k", attempt: 1, referencesSent: 0, costUsd: price.costUsd, qa: fails.length ? "unresolved" : "pass" },
  });
  fs.writeFileSync("/tmp/hayden-scene1-retry.png", result.bytes);
  console.log(JSON.stringify({ id, path: stored.absolutePath, fails, summary: critique.summary, visible: critique.visibleDetail, style: critique.scores["STYLE MATCH"], intent: critique.scores["CREATIVE INTENT MATCH"] }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
