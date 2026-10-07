import type Database from "better-sqlite3";
import { getAsset, insertAsset, listPackAssets, nextVersion, parseAssetMeta, updateAsset, type AssetRow } from "@/lib/executor/assets";
import { getVideoProvider } from "@/lib/executor/providers";
import { localAssetStorage, mp4DurationSeconds } from "@/lib/executor/storage";
import type { AssetMetadata, GenerationReport, GenerationStatus, VideoSubmitResult } from "@/lib/executor/types";
import { getPack, listScenes, type PackRow, type SceneRow } from "@/lib/factory/store";
import { OMNI_COST_NOTE, OMNI_RECORD, omniCostNote } from "@/lib/executor/video/record";

const OPEN_STATUSES = new Set(["QUEUED", "SUBMITTED", "GENERATING", "DOWNLOADING", "REGENERATING"]);

export type SceneVideoReadiness = {
  sceneId: string;
  sceneNumber: number;
  state: "ready" | "blocked" | "generating" | "needs_review" | "approved" | "rejected" | "failed";
  reason: string;
};

export function videoCostSummary(readyScenes: number) {
  if (readyScenes < 1) return "No scene is ready to generate. Estimated provider cost: COST UNKNOWN.";
  return `${readyScenes} scene${readyScenes === 1 ? "" : "s"} ready. Estimated provider cost: ${OMNI_COST_NOTE}`;
}

export function packVideoLabel(scenes: SceneRow[], assets: AssetRow[]) {
  const clips = scenes.map((scene) => latestVideo(assets, scene.id));
  const stored = clips.filter((clip) => clip && clip.file_size && clip.file_size > 0);
  const approved = stored.filter((clip) => clip?.generation_status === "APPROVED");
  if (stored.length === 0) return "No scene video has been made. The final video is not assembled.";
  if (approved.length === scenes.length && scenes.length > 0) return "Approved video scenes. The final video is not assembled.";
  if (stored.length === scenes.length) return "Video scenes are ready for review. The final video is not assembled.";
  return "Video scenes are partially generated. The final video is not assembled.";
}

export function sceneVideoReadiness(db: Database.Database, packId: string): SceneVideoReadiness[] {
  const pack = getPack(db, packId);
  const scenes = listScenes(db, packId);
  if (!pack) return [];
  const assets = listPackAssets(db, packId);
  return scenes.map((scene) => readinessFor(pack, scene, assets));
}

export async function generateSceneVideo(db: Database.Database, packId: string, sceneId: string, feedback?: string): Promise<GenerationReport> {
  const pack = getPack(db, packId);
  const scene = listScenes(db, packId).find((item) => item.id === sceneId);
  const report: GenerationReport = { packId, created: [], skipped: [], failed: [] };
  if (!pack || !scene) {
    report.failed.push({ sceneNumber: null, role: "SCENE_VIDEO", message: "That scene is not in this pack.", assetId: "" });
    return report;
  }
  const assets = listPackAssets(db, packId);
  const ready = readinessFor(pack, scene, assets);
  if (ready.state === "generating") {
    report.skipped.push(sceneId);
    return report;
  }
  if (!feedback && ready.state !== "ready" && ready.state !== "failed" && ready.state !== "rejected") {
    report.failed.push({ sceneNumber: scene.scene_number, role: "SCENE_VIDEO", message: ready.reason, assetId: "" });
    return report;
  }
  if (!feedback && ready.state === "ready" && latestVideo(assets, scene.id)?.file_size) {
    report.skipped.push(sceneId);
    return report;
  }
  const gate = inputGate(pack, scene, assets);
  if (!gate.ok) {
    report.failed.push({ sceneNumber: scene.scene_number, role: "SCENE_VIDEO", message: gate.reason, assetId: "" });
    return report;
  }
  const provider = getVideoProvider();
  if (!provider.connected) {
    report.failed.push({ sceneNumber: scene.scene_number, role: "SCENE_VIDEO", message: "The Gemini API key is not set, so no video job was submitted.", assetId: "" });
    return report;
  }
  const previous = latestVideo(assets, scene.id);
  const id = crypto.randomUUID();
  const prompt = buildVideoPrompt(pack, scene, feedback);
  const metadata: AssetMetadata = {
    startFrameAssetId: gate.start.id,
    endFrameAssetId: gate.end.id,
    durationRequested: scene.duration_seconds,
    costNote: OMNI_COST_NOTE,
    costStatus: "unknown",
    audioInPrompt: true,
    continuityCheck: "Not checked. Hayden reviews the clip. Providing the frames does not mean continuity passed.",
    feedback: feedback || undefined,
    aspectNote: "The model chooses a length from 3 to 10 seconds. The requested length is not pinned.",
  };
  insertSceneVideo(db, {
    id,
    pack,
    scene,
    prompt,
    parentId: previous?.id ?? null,
    version: nextVersion(db, previous?.id ?? null),
    status: feedback ? "REGENERATING" : "QUEUED",
    metadata,
    startId: gate.start.id,
    endId: gate.end.id,
    durationRequested: scene.duration_seconds,
  });
  const started = new Date().toISOString();
  updateAsset(db, id, { startedAt: started, status: "QUEUED" });
  let result: VideoSubmitResult;
  try {
    result = await provider.submit({
      prompt,
      aspectRatio: gate.aspect,
      startFrame: { bytes: gate.startBytes, mimeType: gate.start.mime_type || "image/png" },
      endFrame: { bytes: gate.endBytes, mimeType: gate.end.mime_type || "image/png" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The provider request failed.";
    updateAsset(db, id, { status: "FAILED", errorMessage: message, completedAt: new Date().toISOString(), metadata: { ...metadata, errorCode: "api" } });
    report.failed.push({ sceneNumber: scene.scene_number, role: "SCENE_VIDEO", message, assetId: id });
    return report;
  }
  applyProviderResult(db, id, result, metadata, "submit");
  if (!result.ok) report.failed.push({ sceneNumber: scene.scene_number, role: "SCENE_VIDEO", message: result.message, assetId: id });
  else report.created.push(id);
  return report;
}

export async function generateReadySceneVideos(db: Database.Database, packId: string) {
  const report: GenerationReport = { packId, created: [], skipped: [], failed: [] };
  const items = sceneVideoReadiness(db, packId);
  for (const item of items) {
    if (item.state === "blocked") {
      report.failed.push({ sceneNumber: item.sceneNumber, role: "SCENE_VIDEO", message: item.reason, assetId: "" });
      continue;
    }
    if (item.state !== "ready" && item.state !== "failed") {
      report.skipped.push(item.sceneId);
      continue;
    }
    const sceneReport = await generateSceneVideo(db, packId, item.sceneId);
    report.created.push(...sceneReport.created);
    report.skipped.push(...sceneReport.skipped);
    report.failed.push(...sceneReport.failed);
  }
  return report;
}

export async function regenerateSceneVideo(db: Database.Database, sceneId: string, feedback: string) {
  const scene = db.prepare(`SELECT pack_id FROM production_scenes WHERE id = ?`).get(sceneId) as { pack_id: string } | undefined;
  if (!scene) return { packId: "", created: [], skipped: [], failed: [{ sceneNumber: null, role: "SCENE_VIDEO", message: "That scene is not stored.", assetId: "" }] } satisfies GenerationReport;
  return generateSceneVideo(db, scene.pack_id, sceneId, feedback.trim());
}

let resumedThisProcess = false;

export async function resumeVideoJobsOnce(db: Database.Database) {
  if (resumedThisProcess) return;
  resumedThisProcess = true;
  await resumeVideoJobs(db);
}

export async function resumeVideoJobs(db: Database.Database, packId?: string) {
  const provider = getVideoProvider();
  if (!provider.connected) return;
  const rows = db
    .prepare(
      `SELECT * FROM generated_assets
       WHERE asset_role = 'SCENE_VIDEO' AND generation_status IN ('SUBMITTED', 'GENERATING', 'DOWNLOADING', 'QUEUED')
       ${packId ? "AND production_pack_id = ?" : ""}`,
    )
    .all(...(packId ? [packId] : [])) as AssetRow[];
  for (const row of rows) {
    if (!row.generation_job_id) {
      updateAsset(db, row.id, {
        status: "FAILED",
        errorMessage: "The provider job id was not stored, so the job cannot be recovered. Retry the scene.",
        completedAt: new Date().toISOString(),
      });
      continue;
    }
    const result = await provider.retrieve(row.generation_job_id);
    applyProviderResult(db, row.id, result, parseAssetMeta(row.metadata), "retrieve");
  }
}

export function explainSceneVideo(db: Database.Database, packId: string, sceneNumber?: number) {
  const items = sceneVideoReadiness(db, packId);
  const chosen = sceneNumber ? items.filter((item) => item.sceneNumber === sceneNumber) : items;
  return chosen;
}

function readinessFor(pack: PackRow, scene: SceneRow, assets: AssetRow[]): SceneVideoReadiness {
  const current = latestVideo(assets, scene.id);
  if (current && OPEN_STATUSES.has(current.generation_status)) {
    return { sceneId: scene.id, sceneNumber: scene.scene_number, state: "generating", reason: `Scene ${scene.scene_number} — generating` };
  }
  if (current?.generation_status === "FAILED") {
    return { sceneId: scene.id, sceneNumber: scene.scene_number, state: "failed", reason: `Scene ${scene.scene_number} — failed. ${current.error_message || "No error was stored."}` };
  }
  if (current?.generation_status === "APPROVED" && current.file_size) {
    return { sceneId: scene.id, sceneNumber: scene.scene_number, state: "approved", reason: `Scene ${scene.scene_number} — approved` };
  }
  if (current?.generation_status === "REJECTED" && current.file_size) {
    return { sceneId: scene.id, sceneNumber: scene.scene_number, state: "rejected", reason: `Scene ${scene.scene_number} — rejected` };
  }
  if (current?.file_size && current.generation_status === "NEEDS_REVIEW") {
    return { sceneId: scene.id, sceneNumber: scene.scene_number, state: "needs_review", reason: `Scene ${scene.scene_number} — ready for review` };
  }
  const gate = inputGate(pack, scene, assets);
  if (!gate.ok) return { sceneId: scene.id, sceneNumber: scene.scene_number, state: "blocked", reason: `Scene ${scene.scene_number} — ${gate.reason}` };
  return { sceneId: scene.id, sceneNumber: scene.scene_number, state: "ready", reason: `Scene ${scene.scene_number} — ready` };
}

function inputGate(pack: PackRow, scene: SceneRow, assets: AssetRow[]) {
  const missing: string[] = [];
  if (!scene.video_prompt?.trim()) missing.push("missing video prompt");
  const start = approvedFrame(assets, scene.id, "START_FRAME");
  const end = approvedFrame(assets, scene.id, "END_FRAME");
  if (!start) missing.push("missing approved start frame");
  if (!end) missing.push("missing approved end frame");
  if (scene.duration_seconds == null) missing.push("missing duration");
  if (!pack.aspect_ratio?.trim()) missing.push("missing aspect ratio");
  if (missing.length) return { ok: false as const, reason: missing.join("; ") };
  const duration = scene.duration_seconds as number;
  if (duration < OMNI_RECORD.durationMin || duration > OMNI_RECORD.durationMax) {
    return {
      ok: false as const,
      reason: `Requested: ${duration} sec. Provider supports: a clip from ${OMNI_RECORD.durationMin} to ${OMNI_RECORD.durationMax} seconds. An exact length cannot be selected.`,
    };
  }
  const aspect = pack.aspect_ratio?.trim() ?? "";
  if (aspect !== "9:16" && aspect !== "16:9") {
    return { ok: false as const, reason: `Requested aspect ${aspect}. Provider supports: 9:16 and 16:9.` };
  }
  const storage = localAssetStorage();
  if (!start?.storage_location || !storage.exists(start.storage_location) || !end?.storage_location || !storage.exists(end.storage_location)) {
    return { ok: false as const, reason: "invalid frame. An approved frame file is missing." };
  }
  const startBytes = storage.read(start.storage_location);
  const endBytes = storage.read(end.storage_location);
  if (!startBytes || !endBytes) return { ok: false as const, reason: "invalid frame. An approved frame file could not be read." };
  return { ok: true as const, start, end, startBytes, endBytes, aspect: aspect as "9:16" | "16:9" };
}

function approvedFrame(assets: AssetRow[], sceneId: string, role: "START_FRAME" | "END_FRAME") {
  return assets
    .filter((asset) => asset.scene_id === sceneId && asset.asset_role === role && asset.generation_status === "APPROVED" && asset.file_size && asset.file_size > 0)
    .sort((a, b) => b.version - a.version)[0];
}

export function latestVideo(assets: AssetRow[], sceneId: string) {
  return assets
    .filter((asset) => asset.scene_id === sceneId && asset.asset_role === "SCENE_VIDEO")
    .sort((a, b) => b.version - a.version)[0];
}

export function buildVideoPrompt(pack: PackRow, scene: SceneRow, feedback?: string) {
  return [
    scene.video_prompt?.trim() || "",
    scene.duration_seconds != null ? `Requested length: about ${scene.duration_seconds} seconds.` : "",
    scene.camera ? `Camera: ${scene.camera}` : "",
    scene.action ? `Action: ${scene.action}` : "",
    scene.continuity_from ? `Continuity from the previous scene: ${scene.continuity_from}` : "",
    scene.continuity_into ? `Continuity into the next scene: ${scene.continuity_into}` : "",
    pack.continuity_rules ? `Continuity rules: ${pack.continuity_rules}` : "",
    pack.character_bible ? `Character notes: ${pack.character_bible}` : "",
    scene.voiceover ? `Dialogue or voiceover, natural Australian delivery: ${scene.voiceover}` : "No spoken dialogue.",
    scene.speaker ? `Speaker: ${scene.speaker}` : "",
    pack.voice_direction ? `Voice direction: ${pack.voice_direction}` : "",
    scene.sfx ? `Sound effects: ${scene.sfx}` : "",
    scene.music_notes ? `Music: ${scene.music_notes}` : "",
    pack.music_direction ? `Music direction: ${pack.music_direction}` : "",
    pack.sound_direction ? `Sound direction: ${pack.sound_direction}` : "",
    scene.on_screen_text ? `On-screen text, only if it can be read: ${scene.on_screen_text}` : "",
    "Animate from the first supplied image to the second supplied image. Do not add a logo.",
    feedback?.trim() ? `Change from the previous version: ${feedback.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function insertSceneVideo(
  db: Database.Database,
  input: {
    id: string;
    pack: PackRow;
    scene: SceneRow;
    prompt: string;
    parentId: string | null;
    version: number;
    status: GenerationStatus;
    metadata: AssetMetadata;
    startId: string;
    endId: string;
    durationRequested: number | null;
  },
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO generated_assets (
      id, production_pack_id, scene_id, concept_id, organisation_id, project_id, asset_type, asset_role,
      provider, model, prompt, aspect_ratio, generation_status, created_at, created_by, parent_asset_id, version, metadata,
      start_frame_asset_id, end_frame_asset_id, duration_requested, cost_note, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'SCENE_VIDEO', 'SCENE_VIDEO', ?, ?, ?, ?, ?, ?, 'hayden', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.pack.id,
    input.scene.id,
    input.pack.creative_concept_id,
    input.pack.organisation_id,
    input.pack.project_id,
    getVideoProvider().id,
    getVideoProvider().model,
    input.prompt,
    input.pack.aspect_ratio,
    input.status,
    now,
    input.parentId,
    input.version,
    JSON.stringify(input.metadata),
    input.startId,
    input.endId,
    input.durationRequested,
    OMNI_COST_NOTE,
    now,
  );
}

function applyProviderResult(db: Database.Database, assetId: string, result: VideoSubmitResult, metadata: AssetMetadata, source: "submit" | "retrieve") {
  const current = getAsset(db, assetId);
  if (!current) return;
  if (!result.ok) {
    if (source === "retrieve" && (result.code === "api" || result.code === "timeout")) {
      updateAsset(db, assetId, { errorMessage: result.message, metadata: { ...metadata, errorCode: result.code } });
      return;
    }
    updateAsset(db, assetId, {
      status: "FAILED",
      errorMessage: result.message,
      completedAt: new Date().toISOString(),
      generationJobId: current.generation_job_id,
      metadata: { ...metadata, errorCode: result.code },
    });
    return;
  }
  const jobPatch = {
    generationJobId: result.jobId || current.generation_job_id,
    providerMetadata: JSON.stringify(result.providerMetadata ?? {}),
    provider: getVideoProvider().id,
    model: getVideoProvider().model,
  };
  if (result.bytes) {
    try {
      const stored = localAssetStorage().write(assetId, result.bytes, "video/mp4");
      const durationActual = mp4DurationSeconds(result.bytes);
      updateAsset(db, assetId, {
        ...jobPatch,
        status: "NEEDS_REVIEW",
        storageLocation: stored.absolutePath,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        fileSize: stored.fileSize,
        completedAt: new Date().toISOString(),
        errorMessage: null,
        durationActual,
        costNote: omniCostNote(durationActual),
        metadata: { ...metadata, durationActual, costNote: omniCostNote(durationActual), costStatus: "unknown", providerJobId: result.jobId },
      });
    } catch (error) {
      updateAsset(db, assetId, {
        ...jobPatch,
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "The video file could not be stored.",
        completedAt: new Date().toISOString(),
        metadata: { ...metadata, errorCode: "download" },
      });
    }
    return;
  }
  const status: GenerationStatus = result.state === "downloading" ? "DOWNLOADING" : result.state === "submitted" ? "SUBMITTED" : "GENERATING";
  updateAsset(db, assetId, { ...jobPatch, status, metadata: { ...metadata, providerJobId: result.jobId } });
}
