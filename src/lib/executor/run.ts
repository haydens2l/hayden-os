import type Database from "better-sqlite3";
import { activeRules } from "@/lib/factory/defaults";
import { getPack, listScenes, type SceneRow } from "@/lib/factory/store";
import { FRAME_TYPES, type ProductionType } from "@/lib/factory/types";
import {
  getAsset,
  insertAsset,
  latestForRole,
  listPackAssets,
  nextVersion,
  parseAssetMeta,
  reviewAsset,
  updateAsset,
  type AssetRow,
} from "@/lib/executor/assets";
import { imageListPrice } from "@/lib/executor/pricing";
import { buildImagePrompt, resolveAspect, sceneHasPicture, shouldReferencePreviousEnd } from "@/lib/executor/prompt";
import { runIntelligentFrames, runIntelligentStoryboard } from "@/lib/visual/generate";
import { styleBlock } from "@/lib/content/workflow";
import { imageProvider } from "@/lib/executor/providers";
import { localAssetStorage, sniffImage } from "@/lib/executor/storage";
import type { AssetMetadata, AssetRole, GenerationReport, ImageReference } from "@/lib/executor/types";

const READY = new Set(["NEEDS_REVIEW", "APPROVED", "COMPLETE"]);

export async function generateStoryboard(db: Database.Database, packId: string) {
  const pack = getPack(db, packId);
  const planned = pack?.creative_concept_id
    ? (db.prepare(`SELECT COUNT(*) AS n FROM shot_plans WHERE concept_id = ?`).get(pack.creative_concept_id) as { n: number })
    : { n: 0 };
  if (!planned.n) throw new Error("Visual direction is not ready. Create the visual world before generating a storyboard.");
  const held = styleBlock(db, pack?.creative_concept_id ?? null);
  if (held) throw new Error(held);
  await runIntelligentStoryboard(db, packId);
  return emptyReport(packId);
}

export async function generateFrames(db: Database.Database, packId: string) {
  const pack = getPack(db, packId);
  const planned = pack?.creative_concept_id
    ? (db.prepare(`SELECT COUNT(*) AS n FROM shot_plans WHERE concept_id = ?`).get(pack.creative_concept_id) as { n: number })
    : { n: 0 };
  if (planned.n) {
    await runIntelligentFrames(db, packId);
    return emptyReport(packId);
  }
  return generateRoles(db, packId, "frames");
}

export async function regenerateAsset(db: Database.Database, assetId: string, feedback: string) {
  const parent = getAsset(db, assetId);
  if (!parent?.production_pack_id) throw new Error("That image is not on a production pack.");
  const pack = getPack(db, parent.production_pack_id);
  if (!pack) throw new Error("The production pack is missing.");
  const scenes = listScenes(db, pack.id);
  const scene = scenes.find((item) => item.id === parent.scene_id);
  if (!scene) throw new Error("The scene for that image is missing.");
  const report = emptyReport(pack.id);
  await createImage(db, {
    pack,
    scene,
    scenes,
    role: parent.asset_role as AssetRole,
    rules: ruleLines(db, pack.organisation_id, pack.project_id, pack.model_profile_id),
    parent,
    feedback: feedback.trim(),
    report,
  });
  return report;
}

export { reviewAsset };

async function generateRoles(db: Database.Database, packId: string, mode: "storyboard" | "frames") {
  const pack = getPack(db, packId);
  if (!pack) throw new Error("That production pack is not stored.");
  const scenes = listScenes(db, packId);
  const report = emptyReport(packId);
  if (scenes.length === 0) {
    report.failed.push({ sceneNumber: null, role: mode, message: "This pack has no scenes to draw.", assetId: "" });
    return report;
  }
  if (mode === "frames" && !FRAME_TYPES.has(pack.production_type as ProductionType)) {
    report.failed.push({
      sceneNumber: null,
      role: "START_FRAME",
      message: `Start and end frames are for AI video. This pack is ${pack.production_type}. That is unsupported.`,
      assetId: "",
    });
    return report;
  }
  const rules = ruleLines(db, pack.organisation_id, pack.project_id, pack.model_profile_id);
  const assets = listPackAssets(db, packId);
  for (const scene of scenes) {
    const roles: AssetRole[] = mode === "storyboard" ? ["STORYBOARD_FRAME"] : ["START_FRAME", "END_FRAME"];
    for (const role of roles) {
      const existing = latestForRole(assets, scene.id, role);
      const ready = existing.find((asset) => READY.has(asset.generation_status) && asset.file_size && asset.file_size > 0);
      if (ready) {
        report.skipped.push(ready.id);
        continue;
      }
      if (!sceneHasPicture(scene)) {
        report.failed.push({
          sceneNumber: scene.scene_number,
          role,
          message: "This scene has no visual description. Add what happens before generating.",
          assetId: "",
        });
        continue;
      }
      const stale = existing.find((asset) => asset.generation_status === "GENERATING" || asset.generation_status === "QUEUED");
      if (stale && !stale.file_size) {
        updateAsset(db, stale.id, { status: "FAILED", errorMessage: "The generation did not finish and no file was stored." });
      }
      await createImage(db, { pack, scene, scenes, role, rules, parent: existing[0] ?? null, feedback: null, report });
    }
  }
  return report;
}

async function createImage(
  db: Database.Database,
  input: {
    pack: NonNullable<ReturnType<typeof getPack>>;
    scene: SceneRow;
    scenes: SceneRow[];
    role: AssetRole;
    rules: string[];
    parent: AssetRow | null;
    feedback: string | null;
    report: GenerationReport;
  },
) {
  const aspect = resolveAspect(input.pack.aspect_ratio);
  const id = crypto.randomUUID();
  if ("error" in aspect) {
    insertAsset(db, {
      id,
      packId: input.pack.id,
      sceneId: input.scene.id,
      conceptId: input.pack.creative_concept_id,
      organisationId: input.pack.organisation_id,
      projectId: input.pack.project_id,
      role: input.role,
      prompt: "",
      aspectRatio: input.pack.aspect_ratio || "",
      parentId: input.parent?.id ?? null,
      version: nextVersion(db, input.parent?.id ?? null),
      status: "FAILED",
      metadata: { errorCode: "unsupported_aspect_ratio" },
    });
    updateAsset(db, id, { status: "FAILED", errorMessage: aspect.error, metadata: { errorCode: "unsupported_aspect_ratio" } });
    input.report.failed.push({ sceneNumber: input.scene.scene_number, role: input.role, message: aspect.error, assetId: id });
    return;
  }
  const prompt = buildImagePrompt({ pack: input.pack, scene: input.scene, role: input.role, rules: input.rules, feedback: input.feedback });
  const references = collectReferences(db, input.scene, input.scenes, input.role, input.parent);
  const metadata: AssetMetadata = {
    feedback: input.feedback || undefined,
    referenceAssetIds: references.ids,
    referencesSent: references.sent.length,
    continuityNote: references.note,
    characterLock: "UNKNOWN",
    aspectNote: aspect.note || undefined,
  };
  insertAsset(db, {
    id,
    packId: input.pack.id,
    sceneId: input.scene.id,
    conceptId: input.pack.creative_concept_id,
    organisationId: input.pack.organisation_id,
    projectId: input.pack.project_id,
    role: input.role,
    prompt,
    aspectRatio: aspect.ratio,
    parentId: input.parent?.id ?? null,
    version: nextVersion(db, input.parent?.id ?? null),
    status: input.feedback ? "REGENERATING" : "QUEUED",
    metadata,
  });
  updateAsset(db, id, { status: "GENERATING", metadata });
  const provider = imageProvider();
  let result;
  try {
    result = await provider.generate({ prompt, aspectRatio: aspect.ratio, references: references.sent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The image request failed.";
    updateAsset(db, id, { status: "FAILED", errorMessage: message, metadata: { ...metadata, errorCode: "api" } });
    input.report.failed.push({ sceneNumber: input.scene.scene_number, role: input.role, message, assetId: id });
    return;
  }
  if (!result.ok) {
    updateAsset(db, id, { status: "FAILED", provider: provider.id, model: provider.model, errorMessage: result.message, metadata: { ...metadata, errorCode: result.code } });
    input.report.failed.push({ sceneNumber: input.scene.scene_number, role: input.role, message: result.message, assetId: id });
    return;
  }
  const sniffed = sniffImage(result.bytes);
  let stored;
  try {
    stored = localAssetStorage().write(id, result.bytes, sniffed.mimeType);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The image file could not be stored.";
    updateAsset(db, id, { status: "FAILED", provider: provider.id, model: result.model, errorMessage: message, metadata: { ...metadata, errorCode: "download" } });
    input.report.failed.push({ sceneNumber: input.scene.scene_number, role: input.role, message, assetId: id });
    return;
  }
  const price = imageListPrice(result.model, references.sent.length > 0);
  const ready: AssetMetadata = {
    ...metadata,
    usageImages: 1,
    usageInputImages: references.sent.length,
    costUsd: price.costUsd,
    costBasis: price.costBasis,
    costStatus: price.costStatus,
    providerJobId: result.providerJobId,
  };
  try {
    updateAsset(db, id, {
      status: "NEEDS_REVIEW",
      provider: provider.id,
      model: result.model,
      width: result.width ?? sniffed.width,
      height: result.height ?? sniffed.height,
      storageLocation: stored.absolutePath,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      fileSize: stored.fileSize,
      completedAt: new Date().toISOString(),
      errorMessage: null,
      generationJobId: result.providerJobId,
      metadata: ready,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The image file could not be confirmed.";
    updateAsset(db, id, { status: "FAILED", provider: provider.id, model: result.model, errorMessage: message, metadata: { ...ready, errorCode: "download" } });
    input.report.failed.push({ sceneNumber: input.scene.scene_number, role: input.role, message, assetId: id });
    return;
  }
  input.report.created.push(id);
}

function collectReferences(db: Database.Database, scene: SceneRow, scenes: SceneRow[], role: AssetRole, parent: AssetRow | null) {
  const ids: string[] = [];
  const sent: ImageReference[] = [];
  const notes: string[] = [];
  const storage = localAssetStorage();
  const previous = scenes.find((item) => item.scene_number === scene.scene_number - 1) ?? null;
  if (role === "START_FRAME" && shouldReferencePreviousEnd(scene, previous) && previous) {
    const assets = listPackAssets(db, scene.pack_id);
    const end = latestForRole(assets, previous.id, "END_FRAME").find((asset) => asset.file_size && asset.storage_location && READY.has(asset.generation_status));
    if (end?.storage_location) {
      ids.push(end.id);
      const bytes = storage.read(end.storage_location);
      if (bytes) sent.push({ assetId: end.id, bytes, mimeType: end.mime_type || "image/png" });
      else notes.push("The previous end frame was listed but the file could not be read.");
    } else notes.push("Continuity asks for the previous end frame, and that image is not stored yet.");
  }
  if (parent?.storage_location && parent.file_size) {
    if (!ids.includes(parent.id)) ids.push(parent.id);
    if (sent.length === 0) {
      const bytes = storage.read(parent.storage_location);
      if (bytes) sent.push({ assetId: parent.id, bytes, mimeType: parent.mime_type || "image/png" });
    } else notes.push("The previous version was kept. One reference image was sent. Extra references stay on the record.");
  }
  if (sent.length === 0 && ids.length === 0) notes.push("No reference image was sent. Character consistency across separate generations is UNKNOWN.");
  else notes.push("One reference image was sent. Locking the same face is UNKNOWN.");
  const parentMeta = parent ? parseAssetMeta(parent.metadata) : {};
  if (parentMeta.referenceAssetIds) {
    for (const id of parentMeta.referenceAssetIds) if (!ids.includes(id)) ids.push(id);
  }
  return { ids, sent: sent.slice(0, 1), note: notes.join(" ") };
}

function ruleLines(db: Database.Database, organisationId: string | null, projectId: string | null, modelProfileId: string | null) {
  return activeRules(db, { organisationId, projectId, modelProfileId }).map((rule) => rule.body);
}

function emptyReport(packId: string): GenerationReport {
  return { packId, created: [], skipped: [], failed: [] };
}
