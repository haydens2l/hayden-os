import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { listPackAssets, parseAssetMeta } from "../src/lib/executor/assets";
import { runProductionCommand } from "../src/lib/executor/command";
import { HELP_SECTIONS, capabilityGroups } from "../src/lib/help/guide";
import { getVideoProvider, setVideoProvider } from "../src/lib/executor/providers";
import { localAssetStorage } from "../src/lib/executor/storage";
import type { VideoGenerationProvider } from "../src/lib/executor/types";
import { buildOmniBody } from "../src/lib/executor/video/gemini";
import { generateReadySceneVideos, generateSceneVideo, regenerateSceneVideo, resumeVideoJobs } from "../src/lib/executor/video/run";
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

delete process.env.GEMINI_API_KEY;
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "hayden-video-"));
process.env.ASSET_STORAGE_PATH = storageDir;
const clipPath = path.join(storageDir, "source.mp4");
execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=black:s=160x90:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "1", clipPath], { stdio: "ignore" });
const CLIP = fs.readFileSync(clipPath);
const TINY = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");

const jobs = new Map<string, "hold" | "done">();
let failSubmits = 0;
let pollFailures = 0;
const fixture: VideoGenerationProvider = {
  id: "fixture",
  model: "fixture-video",
  connected: true,
  limitations: [],
  async generate() {
    return { ok: false, code: "unsupported", message: "Use the scene path." };
  },
  async submit(input) {
    if (input.prompt.includes("FORCE_FAIL") && failSubmits > 0) {
      failSubmits -= 1;
      return { ok: false, code: "api", message: "provider submission failure" };
    }
    const jobId = `job-${crypto.randomUUID()}`;
    const hold = input.prompt.includes("HOLD_JOB");
    jobs.set(jobId, hold ? "hold" : "done");
    if (hold) return { ok: true, jobId, state: "generating", providerMetadata: { status: "processing" } };
    return { ok: true, jobId, state: "complete", bytes: CLIP, mimeType: "video/mp4", providerMetadata: { status: "completed" } };
  },
  async retrieve(jobId) {
    if (pollFailures > 0) {
      pollFailures -= 1;
      return { ok: false, code: "api", message: "The provider job could not be checked." };
    }
    if (!jobs.has(jobId)) return { ok: false, code: "api", message: "Unknown job." };
    jobs.set(jobId, "done");
    return { ok: true, jobId, state: "complete", bytes: CLIP, mimeType: "video/mp4" };
  },
};

function openDb(name: string) {
  const file = path.join(os.tmpdir(), `hayden-video-${name}-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  syncDatabase(db);
  return { db, file };
}

function insertPack(db: Database.Database, scenes: Array<{ prompt: string; duration: number; aspect?: string }>, aspect = "9:16") {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO production_packs (
      id, root_id, version, organisation_id, brand, production_type, aspect_ratio, number_of_scenes, status,
      voice_direction, character_bible, continuity_rules, music_direction, unapproved_override, executor, created_by, created_at, updated_at
    ) VALUES (?, ?, 1, 'property-made-simple', 'Property Made Simple', 'ai_video', ?, ?, 'needs_review', 'Calm Australian.', 'Dave.', 'Match the frames.', 'Sparse.', 0, 'human', 'content', ?, ?)`,
  ).run(id, id, aspect, scenes.length, now, now);
  const sceneIds = scenes.map((scene, index) => {
    const sceneId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO production_scenes (
        id, pack_id, scene_number, duration_seconds, objective, visual, video_prompt, voiceover, sfx, music_notes, camera
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'The house is still there.', 'Room tone.', 'None.', 'Static.')`,
    ).run(sceneId, id, index + 1, scene.duration, scene.prompt, scene.prompt, scene.prompt);
    return sceneId;
  });
  return { id, sceneIds };
}

function approveFrame(db: Database.Database, packId: string, sceneId: string, role: "START_FRAME" | "END_FRAME", status: "APPROVED" | "NEEDS_REVIEW") {
  const assetId = crypto.randomUUID();
  const stored = localAssetStorage().write(assetId, TINY, "image/png");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO generated_assets (
      id, production_pack_id, scene_id, asset_type, asset_role, prompt, aspect_ratio, generation_status,
      storage_location, file_name, mime_type, file_size, created_at, completed_at, created_by, approved_by, approved_at, version
    ) VALUES (?, ?, ?, 'image', ?, 'frame', '9:16', ?, ?, ?, ?, ?, ?, ?, 'hayden', ?, ?, 1)`,
  ).run(assetId, packId, sceneId, role, status, stored.absolutePath, stored.fileName, stored.mimeType, stored.fileSize, now, now, status === "APPROVED" ? "hayden" : null, status === "APPROVED" ? now : null);
  return assetId;
}

async function main() {
  setVideoProvider(fixture);
  const body = buildOmniBody(
    {
      prompt: "Walk to the door.",
      aspectRatio: "9:16",
      startFrame: { bytes: TINY, mimeType: "image/png" },
      endFrame: { bytes: TINY, mimeType: "image/jpeg" },
    },
    "gemini-omni-1.1-flash",
  );
  check("request sends start and end frames", body.input.filter((item) => item.type === "image").length === 2 && body.input[2]?.type === "text");
  check("request does not send an audio file or an exact duration", !("audio" in body) && !("duration" in body) && body.response_format.aspect_ratio === "9:16");

  const first = openDb("scenes");
  const pack = insertPack(first.db, [
    { prompt: "Dave sits on the couch.", duration: 6 },
    { prompt: "Dave stands up.", duration: 6 },
    { prompt: "Dave looks outside.", duration: 6 },
  ]);
  for (const sceneId of pack.sceneIds) approveFrame(first.db, pack.id, sceneId, "START_FRAME", "APPROVED");
  approveFrame(first.db, pack.id, pack.sceneIds[0], "END_FRAME", "APPROVED");
  approveFrame(first.db, pack.id, pack.sceneIds[1], "END_FRAME", "APPROVED");
  approveFrame(first.db, pack.id, pack.sceneIds[2], "END_FRAME", "NEEDS_REVIEW");

  const missing = await generateSceneVideo(first.db, pack.id, pack.sceneIds[2]);
  const missingAssets = listPackAssets(first.db, pack.id).filter((asset) => asset.asset_role === "SCENE_VIDEO" && asset.scene_id === pack.sceneIds[2]);
  check("D missing approved end frame is refused", missing.created.length === 0 && /missing approved end frame/.test(missing.failed[0]?.message || "") && missingAssets.length === 0, missing.failed[0]?.message);

  const question = await runProductionCommand(first.db, "Which scenes are missing frames?");
  check("command lists the blocked scene", /missing approved end frame/.test(question.summary) && /Scene 1 — ready/.test(question.summary));

  const before = first.db.prepare(`SELECT status FROM production_packs WHERE id = ?`).get(pack.id) as { status: string };
  const report = await generateReadySceneVideos(first.db, pack.id);
  const after = first.db.prepare(`SELECT status FROM production_packs WHERE id = ?`).get(pack.id) as { status: string };
  const videos = listPackAssets(first.db, pack.id).filter((asset) => asset.asset_role === "SCENE_VIDEO");
  const sceneOne = videos.find((asset) => asset.scene_id === pack.sceneIds[0]);
  const sceneThree = videos.filter((asset) => asset.scene_id === pack.sceneIds[2]);
  check("A provider job is stored", Boolean(sceneOne?.generation_job_id) && sceneOne?.provider === "fixture");
  check("B video file is stored", Boolean(sceneOne?.storage_location && sceneOne.file_size && sceneOne.file_size > 0 && sceneOne.mime_type === "video/mp4" && sceneOne.generation_status === "NEEDS_REVIEW"));
  check("stored file is an mp4", Boolean(sceneOne?.storage_location && fs.readFileSync(sceneOne.storage_location).subarray(4, 8).toString() === "ftyp"));
  check("prompt kept the spoken line", /house is still there/.test(sceneOne?.prompt || ""));
  check("lineage points at the approved frames", Boolean(sceneOne?.start_frame_asset_id && sceneOne.end_frame_asset_id));
  check("G two scenes generate and the third stays blocked", report.created.length === 2 && sceneThree.length === 0 && videos.length === 2, report.failed.map((item) => item.message).join(" | "));
  check("G pack is not marked complete", before.status === after.status && after.status !== "complete");

  first.db.close();
  const reopened = new Database(first.file);
  const survived = reopened.prepare(`SELECT storage_location, file_size, generation_status FROM generated_assets WHERE id = ?`).get(sceneOne?.id) as { storage_location: string; file_size: number; generation_status: string };
  check("C video survives restart", survived.generation_status === "NEEDS_REVIEW" && survived.file_size > 0 && fs.existsSync(survived.storage_location));
  reopened.close();
  const again = new Database(first.file);

  const regen = await regenerateSceneVideo(again, pack.sceneIds[0], "The character changes halfway through.");
  const versions = listPackAssets(again, pack.id).filter((asset) => asset.scene_id === pack.sceneIds[0] && asset.asset_role === "SCENE_VIDEO").sort((a, b) => a.version - b.version);
  const v2 = versions[1];
  check("E version 1 remains and version 2 is created", regen.created.length === 1 && versions.length === 2 && versions[0].version === 1 && versions[0].file_size! > 0 && v2.version === 2);
  check("E feedback is stored", parseAssetMeta(v2.metadata).feedback === "The character changes halfway through." && /halfway/.test(v2.prompt || ""));

  const failPack = insertPack(again, [{ prompt: "FORCE_FAIL Dave drops the letter.", duration: 6 }]);
  approveFrame(again, failPack.id, failPack.sceneIds[0], "START_FRAME", "APPROVED");
  approveFrame(again, failPack.id, failPack.sceneIds[0], "END_FRAME", "APPROVED");
  failSubmits = 1;
  const failed = await generateSceneVideo(again, failPack.id, failPack.sceneIds[0]);
  const failRow = listPackAssets(again, failPack.id).find((asset) => asset.generation_status === "FAILED");
  check("F failure is stored", failed.created.length === 0 && failRow?.error_message === "provider submission failure" && !failRow.file_size);
  const retried = await generateSceneVideo(again, failPack.id, failPack.sceneIds[0]);
  const failVersions = listPackAssets(again, failPack.id).filter((asset) => asset.asset_role === "SCENE_VIDEO");
  check("F retry keeps the failed attempt", retried.created.length === 1 && failVersions.some((asset) => asset.generation_status === "FAILED") && failVersions.some((asset) => asset.generation_status === "NEEDS_REVIEW"));

  const held = insertPack(again, [{ prompt: "HOLD_JOB Dave waits.", duration: 6 }]);
  approveFrame(again, held.id, held.sceneIds[0], "START_FRAME", "APPROVED");
  approveFrame(again, held.id, held.sceneIds[0], "END_FRAME", "APPROVED");
  const pending = await generateSceneVideo(again, held.id, held.sceneIds[0]);
  const pendingRow = listPackAssets(again, held.id).find((asset) => asset.asset_role === "SCENE_VIDEO");
  check("H job stays unresolved without a file", pending.created.length === 1 && pendingRow?.generation_status === "GENERATING" && Boolean(pendingRow.generation_job_id) && !pendingRow.file_size);
  const pendingId = pendingRow?.id;
  const pendingJob = pendingRow?.generation_job_id;
  again.close();
  const recoveredDb = new Database(first.file);
  const pendingAfter = recoveredDb.prepare(`SELECT generation_status, generation_job_id, file_size FROM generated_assets WHERE id = ?`).get(pendingId) as { generation_status: string; generation_job_id: string; file_size: number | null };
  check("H job id survives restart", pendingAfter.generation_status === "GENERATING" && pendingAfter.generation_job_id === pendingJob && !pendingAfter.file_size);
  pollFailures = 1;
  await resumeVideoJobs(recoveredDb);
  const afterPoll = recoveredDb.prepare(`SELECT generation_status, error_message, file_size FROM generated_assets WHERE id = ?`).get(pendingId) as { generation_status: string; error_message: string; file_size: number | null };
  check("H a poll failure does not mark the job failed", afterPoll.generation_status === "GENERATING" && /could not be checked/.test(afterPoll.error_message || "") && !afterPoll.file_size);
  await resumeVideoJobs(recoveredDb);
  const done = recoveredDb.prepare(`SELECT generation_status, file_size, storage_location FROM generated_assets WHERE id = ?`).get(pendingId) as { generation_status: string; file_size: number; storage_location: string };
  check("H status can be recovered from the provider job", done.generation_status === "NEEDS_REVIEW" && done.file_size > 0 && fs.existsSync(done.storage_location));

  const long = insertPack(recoveredDb, [{ prompt: "Too long.", duration: 12 }]);
  approveFrame(recoveredDb, long.id, long.sceneIds[0], "START_FRAME", "APPROVED");
  approveFrame(recoveredDb, long.id, long.sceneIds[0], "END_FRAME", "APPROVED");
  const refused = await generateSceneVideo(recoveredDb, long.id, long.sceneIds[0]);
  check("unsupported duration is not changed", refused.created.length === 0 && /Requested: 12 sec/.test(refused.failed[0]?.message || "") && /3 to 10/.test(refused.failed[0]?.message || ""));

  const square = insertPack(recoveredDb, [{ prompt: "Square.", duration: 6 }], "1:1");
  approveFrame(recoveredDb, square.id, square.sceneIds[0], "START_FRAME", "APPROVED");
  approveFrame(recoveredDb, square.id, square.sceneIds[0], "END_FRAME", "APPROVED");
  const squareRun = await generateSceneVideo(recoveredDb, square.id, square.sceneIds[0]);
  check("unsupported aspect is refused", squareRun.created.length === 0 && /9:16 and 16:9/.test(squareRun.failed[0]?.message || ""));

  const help = HELP_SECTIONS.find((section) => section.id === "video-scenes");
  const helpText = `${help?.title} ${(help?.paragraphs ?? []).join(" ")} ${(help?.examples ?? []).join(" ")}`;
  check("I how to generate video scenes matches the workflow", /How to generate video scenes/.test(helpText) && /not the final assembled video/.test(helpText) && /Generate the video for Scene 1/.test(helpText));
  const capabilities = capabilityGroups();
  check("I scene video is not listed as available without a Gemini key", capabilities.video.built === true && capabilities.video.configured === false && /not currently configured/i.test(capabilities.video.reason) && !capabilities.available.some((item) => /scene video/i.test(item)));
  setVideoProvider(null);
  check("live provider is not connected without a key", getVideoProvider().connected === false);

  recoveredDb.close();
  if (failures.length) {
    console.error(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log("\nvideo checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
