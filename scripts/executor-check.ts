import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { getAsset, listPackAssets, parseAssetMeta } from "../src/lib/executor/assets";
import { HELP_SECTIONS, capabilityGroups } from "../src/lib/help/guide";
import { imageListPrice } from "../src/lib/executor/pricing";
import { setImageProvider, videoProvider } from "../src/lib/executor/providers";
import type { ImageGenerationProvider } from "../src/lib/executor/types";
import { generateFrames, generateStoryboard, regenerateAsset, reviewAsset } from "../src/lib/executor/run";
import { localAssetStorage } from "../src/lib/executor/storage";
import { syncDatabase } from "../src/lib/db/seed";

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS ${name}`);
    return;
  }
  failures.push(detail ? `${name} — ${detail}` : name);
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

const TINY = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "hayden-assets-"));
process.env.ASSET_STORAGE_PATH = storageDir;

let forceFailsLeft = 0;
const fixture: ImageGenerationProvider = {
  id: "fixture",
  model: "fixture-image",
  connected: true,
  limitations: ["Character identity lock is UNKNOWN."],
  async generate(request) {
    if (request.prompt.includes("FORCE_FAIL") && forceFailsLeft > 0) {
      forceFailsLeft -= 1;
      return { ok: false, code: "timeout", message: "provider timeout" };
    }
    if (request.aspectRatio === "7:1") return { ok: false, code: "unsupported_aspect_ratio", message: "Unsupported aspect ratio: 7:1" };
    return { ok: true, bytes: TINY, mimeType: "image/png", width: 1, height: 1, model: "fixture-image", providerJobId: null };
  },
};

function openDb(name: string) {
  const file = path.join(os.tmpdir(), `hayden-executor-${name}-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  syncDatabase(db);
  return { db, file };
}

function insertPack(db: Database.Database, productionType: string, aspect: string | null, scenes: Array<{ visual: string; continuity?: string }>) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO production_packs (
      id, root_id, version, organisation_id, brand, production_type, aspect_ratio, number_of_scenes, status,
      character_bible, continuity_rules, unapproved_override, executor, created_by, created_at, updated_at
    ) VALUES (?, ?, 1, 'property-made-simple', 'Property Made Simple', ?, ?, ?, 'needs_review', 'Dave, suburban, unpolished.', 'Match the character when a scene says so.', 0, 'human', 'content', ?, ?)`,
  ).run(id, id, productionType, aspect, scenes.length, now, now);
  scenes.forEach((scene, index) => {
    db.prepare(
      `INSERT INTO production_scenes (
        id, pack_id, scene_number, duration_seconds, objective, visual, action, characters, location, camera, start_frame, end_frame, continuity_from
      ) VALUES (?, ?, ?, 6, ?, ?, ?, 'Dave', 'Suburban lounge', 'Medium, eye level', ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      id,
      index + 1,
      scene.visual,
      scene.visual,
      `Dave ${scene.visual}`,
      `Start: ${scene.visual}`,
      `End: ${scene.visual}`,
      scene.continuity ?? null,
    );
  });
  return id;
}

async function main() {
  delete process.env.GEMINI_API_KEY;
  setImageProvider(fixture);
  forceFailsLeft = 0;
  const price = imageListPrice("grok-imagine-image-2.0", false);
  check("list price is the published 4 cents", price.costUsd === 0.04 && price.costStatus === "list_price");
  check("edit total is unknown", imageListPrice("grok-imagine-image-2.0", true).costStatus === "unknown");

  const first = openDb("story");
  const storyId = insertPack(first.db, "ai_video", "9:16", [
    { visual: "Dave sits on the couch." },
    { visual: "The housemate walks in.", continuity: "Continue from the previous end frame. Same character." },
    { visual: "Dave looks at the empty chair." },
  ]);
  const story = await generateStoryboard(first.db, storyId);
  const storyAssets = listPackAssets(first.db, storyId).filter((asset) => asset.asset_role === "STORYBOARD_FRAME" && asset.generation_status === "NEEDS_REVIEW");
  check("A storyboard files exist", story.created.length === 3 && storyAssets.length === 3 && storyAssets.every((asset) => asset.storage_location && fs.existsSync(asset.storage_location) && (asset.file_size ?? 0) > 0));
  check("A storyboard is not approved", storyAssets.every((asset) => !asset.approved_by));

  const frames = await generateFrames(first.db, storyId);
  const frameAssets = listPackAssets(first.db, storyId).filter((asset) => asset.asset_role === "START_FRAME" || asset.asset_role === "END_FRAME");
  const readyFrames = frameAssets.filter((asset) => asset.generation_status === "NEEDS_REVIEW" && asset.storage_location && fs.existsSync(asset.storage_location));
  check("B six frame files", frames.failed.length === 0 && readyFrames.length === 6, `created ${frames.created.length} failed ${frames.failed.map((item) => item.message).join("; ")}`);
  const scenes = first.db.prepare(`SELECT id, scene_number FROM production_scenes WHERE pack_id = ? ORDER BY scene_number`).all(storyId) as Array<{ id: string; scene_number: number }>;
  const scene2Start = listPackAssets(first.db, storyId).find((asset) => asset.scene_id === scenes[1]?.id && asset.asset_role === "START_FRAME");
  const scene1End = listPackAssets(first.db, storyId).find((asset) => asset.scene_id === scenes[0]?.id && asset.asset_role === "END_FRAME");
  const continuity = parseAssetMeta(scene2Start?.metadata ?? null);
  check("continuity reference stored", Boolean(scene1End && continuity.referenceAssetIds?.includes(scene1End.id) && continuity.characterLock === "UNKNOWN"));

  const file = first.file;
  const remembered = readyFrames.map((asset) => asset.storage_location);
  first.db.close();
  const reopened = new Database(file);
  const afterRestart = reopened.prepare(`SELECT id, storage_location, file_size, generation_status FROM generated_assets WHERE production_pack_id = ? AND asset_role IN ('START_FRAME', 'END_FRAME')`).all(storyId) as Array<{ storage_location: string; file_size: number; generation_status: string }>;
  check("C images survive reopen", afterRestart.length === 6 && afterRestart.every((asset) => asset.file_size > 0 && fs.existsSync(asset.storage_location)) && remembered.every((location) => location && fs.existsSync(location)));
  reopened.close();
  const again = new Database(file);

  const scene2End = listPackAssets(again, storyId).find((asset) => asset.scene_id === scenes[1]?.id && asset.asset_role === "END_FRAME");
  const regen = scene2End ? await regenerateAsset(again, scene2End.id, "Dave looks too polished.") : null;
  const versions = listPackAssets(again, storyId).filter((asset) => asset.scene_id === scenes[1]?.id && asset.asset_role === "END_FRAME");
  const child = versions.find((asset) => asset.id !== scene2End?.id);
  check(
    "D regeneration keeps the original",
    Boolean(regen && regen.created.length === 1 && scene2End && getAsset(again, scene2End.id)?.storage_location && child?.parent_asset_id === scene2End.id && child.version === 2 && parseAssetMeta(child.metadata).feedback === "Dave looks too polished." && fs.existsSync(scene2End.storage_location || "") && fs.existsSync(child.storage_location || "")),
  );

  const target = storyAssets[0];
  const packBefore = again.prepare(`SELECT status FROM production_packs WHERE id = ?`).get(storyId) as { status: string };
  if (target) reviewAsset(again, target.id, "APPROVED");
  const approved = target ? getAsset(again, target.id) : undefined;
  const packAfter = again.prepare(`SELECT status FROM production_packs WHERE id = ?`).get(storyId) as { status: string };
  const videos = again.prepare(`SELECT COUNT(*) AS n FROM generated_assets WHERE asset_type = 'video'`).get() as { n: number };
  check("E approval does not finish the video", approved?.generation_status === "APPROVED" && approved.approved_by === "hayden" && packAfter.status === packBefore.status && videos.n === 0);

  forceFailsLeft = 1;
  const failDb = openDb("fail");
  const failPack = insertPack(failDb.db, "ai_video", "9:16", [{ visual: "FORCE_FAIL the provider" }, { visual: "A quiet kitchen." }]);
  const failed = await generateStoryboard(failDb.db, failPack);
  const failRow = listPackAssets(failDb.db, failPack).find((asset) => asset.generation_status === "FAILED");
  const kept = failDb.db.prepare(`SELECT id FROM production_packs WHERE id = ?`).get(failPack);
  check("F failure is stored and the pack remains", Boolean(failRow?.error_message && !failRow.file_size && kept && failed.created.length === 1), failRow?.error_message ?? undefined);
  const retry = await generateStoryboard(failDb.db, failPack);
  const retried = listPackAssets(failDb.db, failPack).filter((asset) => asset.scene_id === failRow?.scene_id);
  check("F retry keeps the failed attempt", retry.created.length === 1 && retried.some((asset) => asset.generation_status === "FAILED") && retried.some((asset) => asset.generation_status === "NEEDS_REVIEW"));

  const bad = openDb("bad");
  const badPack = insertPack(bad.db, "image_ad", "7:1", [{ visual: "A house." }]);
  const badRun = await generateFrames(bad.db, badPack);
  const aspectRun = await generateStoryboard(bad.db, badPack);
  const badAssets = listPackAssets(bad.db, badPack);
  const video = await videoProvider.generate({ prompt: "Make the clip." });
  check("G unsupported frame type", badRun.failed.some((item) => /unsupported/i.test(item.message)) && badRun.created.length === 0);
  check("G unsupported aspect creates no file", aspectRun.created.length === 0 && badAssets.every((asset) => !asset.file_size) && badAssets.some((asset) => /unsupported aspect/i.test(asset.error_message || "")));
  check("G video says not connected", video.ok === false && video.code === "unsupported" && /not connected/i.test(video.message));

  const helpText = HELP_SECTIONS.map((section) => `${section.title} ${section.paragraphs.join(" ")} ${(section.examples ?? []).join(" ")}`).join("\n");
  check("H how to create content", /how to create content/i.test(helpText) && /production pack/i.test(helpText));
  check("H how to storyboard", /visual storyboard/i.test(helpText) && /Make me a visual storyboard/.test(helpText));
  check("H how to frames", /start and end frames/i.test(helpText));
  check("H approve and regenerate", /Regenerate/.test(helpText) && /Approve/.test(helpText));
  check("H agents today and brain", /AI team/.test(helpText) && /Today is the attention list/.test(helpText) && /Business Brain/.test(helpText));

  const capabilities = capabilityGroups();
  check("I scene video is not listed until the Gemini key is set", capabilities.notConnected.some((item) => /built and not configured/i.test(item)) && !capabilities.available.some((item) => /scene video/i.test(item)));
  check("storage root is the test directory", localAssetStorage().root() === storageDir);

  setImageProvider(null);
  if (failures.length) {
    console.error(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log("\nexecutor checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
