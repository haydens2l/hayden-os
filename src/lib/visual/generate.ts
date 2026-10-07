import type Database from "better-sqlite3";
import { getPack, listScenes } from "@/lib/factory/store";
import { insertAsset, nextVersion, updateAsset, type AssetRow } from "@/lib/executor/assets";
import { imageListPrice } from "@/lib/executor/pricing";
import { imageProvider } from "@/lib/executor/providers";
import { localAssetStorage, sniffImage } from "@/lib/executor/storage";
import type { AssetMetadata, AssetRole, ImageReference } from "@/lib/executor/types";
import { approvedVisualRules, suggestVisualRule } from "@/lib/visual/brain";
import { compileFramePrompt, type ShotSlice, type StyleProfile } from "@/lib/visual/compiler";
import { critiqueImage, failedDimensions } from "@/lib/visual/critic";
import { getIntent } from "@/lib/visual/intent";
import { currentStyleRules } from "@/lib/content/workflow";

type Settings = { auto_regen: number; max_retries: number; hero_candidates: number };

export function storyboardEstimate(db: Database.Database, conceptId: string) {
  const settings = visualSettings(db);
  const shots = db.prepare(`SELECT role FROM shot_plans WHERE concept_id = ?`).all(conceptId) as Array<{ role: string }>;
  const heroes = shots.filter((shot) => shot.role === "hero").length;
  const first = shots.length + 2;
  const extra = settings.auto_regen ? first * settings.max_retries : 0;
  const price = imageListPrice("grok-imagine-image-2.0", false);
  const each = price.costUsd ?? 0;
  return {
    frames: shots.length,
    heroes,
    firstPass: first,
    maximumGenerations: first + extra,
    estimateUsd: price.costUsd == null ? null : (first + extra) * each,
    basis: price.costBasis,
  };
}

export async function runIntelligentStoryboard(db: Database.Database, packId: string) {
  const pack = getPack(db, packId);
  if (!pack?.creative_concept_id) throw new Error("This pack is not tied to a concept.");
  const conceptId = pack.creative_concept_id;
  const lock = getIntent(db, conceptId);
  const style = db.prepare(`SELECT * FROM visual_style_profiles WHERE concept_id = ? ORDER BY created_at DESC LIMIT 1`).get(conceptId) as StyleProfile | undefined;
  const shots = db.prepare(`SELECT * FROM shot_plans WHERE concept_id = ? ORDER BY scene_number`).all(conceptId) as ShotSlice[];
  if (!lock || !style || shots.length === 0) throw new Error("Visual direction is not ready. Create it before generating a storyboard.");
  if (lock.brand === "UNKNOWN BRAND") throw new Error("UNKNOWN BRAND. Name the brand before generation.");
  const settings = visualSettings(db);
  const rules = approvedVisualRules(db, lock.organisation_id).map((rule) => rule.body);
  const scenes = listScenes(db, packId);
  const styleRun = await makeFrame(db, {
    packId,
    conceptId,
    organisationId: lock.organisation_id,
    sceneId: null,
    role: "REFERENCE_IMAGE",
    kind: "style",
    mode: "hero",
    purpose: "Style anchor for this storyboard. One frame that shows the medium.",
    brand: lock.brand,
    style,
    shot: anchorShot(lock.visual_medium, lock.core_device, lock.required_motif),
    rules,
    reference: null,
    referencePurpose: "",
    brief: criticBrief(lock, style, "This is the style anchor. Fail STYLE MATCH if it is a photograph or live action while the medium is a sketch."),
    settings,
    attempt: 1,
  });
  const characterRun = await makeFrame(db, {
    packId,
    conceptId,
    organisationId: lock.organisation_id,
    sceneId: null,
    role: "CHARACTER_REFERENCE",
    kind: "character",
    mode: "hero",
    purpose: "Character anchor. The same two people, in the locked medium.",
    brand: lock.brand,
    style,
    shot: {
      ...anchorShot(lock.visual_medium, "Two recurring men, distinct from each other.", "Same faces if they appear again."),
      subject: "The waiting man and his friend, shown clearly enough to reuse.",
      environment: "Plain paper background. No extra rooms.",
    },
    rules,
    reference: styleRun.ref,
    referencePurpose: "style",
    brief: criticBrief(lock, style, "Character anchor. Fail STYLE MATCH if photoreal. Fail CHARACTER CONSISTENCY only if a person is missing."),
    settings,
    attempt: 1,
  });
  const reports: string[] = [];
  let previous: AssetRow | null = null;
  for (const shot of shots) {
    const scene = scenes.find((item) => item.scene_number === shot.scene_number);
    const reference = characterRun.ref ?? styleRun.ref;
    const saved = await makeFrame(db, {
      packId,
      conceptId,
      organisationId: lock.organisation_id,
      sceneId: scene?.id ?? null,
      role: "STORYBOARD_FRAME",
      kind: "scene",
      mode: shot.role === "hero" ? "hero" : "standard",
      purpose: shot.story_purpose || `Scene ${shot.scene_number}`,
      brand: lock.brand,
      style,
      shot,
      rules,
      reference,
      referencePurpose: characterRun.ref ? "character" : "style",
      brief: criticBrief(lock, style, `Scene ${shot.scene_number}. ${shot.story_purpose ?? ""} Joke: ${shot.visual_joke ?? "none"}. Required composition: ${shot.composition ?? ""}. Intended change from the previous frame: ${shot.continuity_dependency ?? "none"}. ${currentStyleRules(db, conceptId)}`),
      compare: previous,
      settings,
      attempt: 1,
    });
    previous = saved.asset;
    reports.push(`Scene ${shot.scene_number}: ${saved.qa === "pass" ? "passed visual QA" : saved.reason}`);
  }
  const unresolved = reports.filter((line) => !line.includes("passed visual QA"));
  if (unresolved.length) {
    const title = (db.prepare(`SELECT title FROM creative_concepts WHERE id = ?`).get(conceptId) as { title: string } | undefined)?.title ?? "This concept";
    db.prepare(`INSERT INTO agent_notices (id, agent_id, job_id, summary, requires_hayden, created_at) VALUES (?, 'chief-of-staff', NULL, ?, 1, ?)`).run(
      crypto.randomUUID(),
      `${lock.brand} — ${title} needs you. ${unresolved.join(" ")}`,
      new Date().toISOString(),
    );
  }
  return { reports, unresolved: unresolved.length };
}

export async function runIntelligentFrames(db: Database.Database, packId: string) {
  const pack = getPack(db, packId);
  if (!pack?.creative_concept_id) throw new Error("This pack is not tied to a concept.");
  const conceptId = pack.creative_concept_id;
  const lock = getIntent(db, conceptId);
  const style = db.prepare(`SELECT * FROM visual_style_profiles WHERE concept_id = ? ORDER BY created_at DESC LIMIT 1`).get(conceptId) as StyleProfile | undefined;
  const shots = db.prepare(`SELECT * FROM shot_plans WHERE concept_id = ? ORDER BY scene_number`).all(conceptId) as ShotSlice[];
  if (!lock || !style || shots.length === 0) throw new Error("Visual direction is not ready. Approve the storyboard world before start and end frames.");
  if (lock.brand === "UNKNOWN BRAND") throw new Error("UNKNOWN BRAND. Name the brand before generation.");
  const settings = visualSettings(db);
  const rules = approvedVisualRules(db, lock.organisation_id).map((rule) => rule.body);
  const scenes = listScenes(db, packId);
  const anchor = db
    .prepare(
      `SELECT a.id, a.storage_location, a.mime_type
       FROM visual_anchors v
       JOIN generated_assets a ON a.id = v.asset_id
       WHERE v.concept_id = ? AND v.kind = 'character' AND a.file_size > 0
       ORDER BY CASE v.status WHEN 'approved' THEN 0 ELSE 1 END, v.created_at DESC
       LIMIT 1`,
    )
    .get(conceptId) as { id: string; storage_location: string | null; mime_type: string | null } | undefined;
  const anchorBytes = anchor?.storage_location ? localAssetStorage().read(anchor.storage_location) : null;
  for (const shot of shots) {
    const scene = scenes.find((item) => item.scene_number === shot.scene_number);
    const board = scene
      ? (db.prepare(`SELECT id, storage_location, mime_type FROM generated_assets WHERE scene_id = ? AND asset_role = 'STORYBOARD_FRAME' AND file_size > 0 ORDER BY created_at DESC LIMIT 1`).get(scene.id) as
          | { id: string; storage_location: string | null; mime_type: string | null }
          | undefined)
      : undefined;
    const boardBytes = board?.storage_location ? localAssetStorage().read(board.storage_location) : null;
    const reference = board && boardBytes
      ? { id: board.id, bytes: boardBytes, mimeType: board.mime_type || "image/jpeg" }
      : anchor && anchorBytes
        ? { id: anchor.id, bytes: anchorBytes, mimeType: anchor.mime_type || "image/jpeg" }
        : null;
    const referencePurpose = board && boardBytes ? "storyboard" : reference ? "character" : "";
    await makeFrame(db, {
      packId,
      conceptId,
      organisationId: lock.organisation_id,
      sceneId: scene?.id ?? null,
      role: "START_FRAME",
      kind: "scene",
      mode: shot.role === "hero" ? "hero" : "standard",
      purpose: shot.story_purpose || `Scene ${shot.scene_number} start`,
      brand: lock.brand,
      style,
      shot,
      rules,
      reference,
      referencePurpose,
      brief: criticBrief(lock, style, `Start frame, scene ${shot.scene_number}. ${shot.composition ?? ""}`),
      settings,
      attempt: 1,
    });
    await makeFrame(db, {
      packId,
      conceptId,
      organisationId: lock.organisation_id,
      sceneId: scene?.id ?? null,
      role: "END_FRAME",
      kind: "scene",
      mode: shot.role === "hero" ? "hero" : "standard",
      purpose: shot.continuity_dependency || `Scene ${shot.scene_number} end. Show only the change this shot plan names.`,
      brand: lock.brand,
      style,
      shot,
      rules,
      reference,
      referencePurpose,
      brief: criticBrief(lock, style, `End frame, scene ${shot.scene_number}. Intended change: ${shot.continuity_dependency ?? "none"}.`),
      settings,
      attempt: 1,
    });
  }
}

async function makeFrame(
  db: Database.Database,
  input: {
    packId: string;
    conceptId: string;
    organisationId: string | null;
    sceneId: string | null;
    role: AssetRole;
    kind: string;
    mode: "draft" | "standard" | "hero";
    purpose: string;
    brand: string;
    style: StyleProfile;
    shot: ShotSlice;
    rules: string[];
    reference: { id: string; bytes: Buffer; mimeType: string } | null;
    referencePurpose: string;
    brief: string;
    compare?: AssetRow | null;
    settings: Settings;
    attempt: number;
    fix?: string;
  },
): Promise<{ asset: AssetRow | null; ref: { id: string; bytes: Buffer; mimeType: string } | null; qa: "pass" | "unresolved"; reason: string }> {
  const api = input.mode === "draft" ? { quality: "low" as const, resolution: "1k" as const } : input.mode === "hero" ? { quality: "medium" as const, resolution: "2k" as const } : { quality: "medium" as const, resolution: "1k" as const };
  const prompt = compileFramePrompt({
    brand: input.brand,
    purpose: input.purpose,
    style: input.style,
    shot: input.shot,
    continuity: input.shot.continuity_dependency || "No previous frame is required for this image.",
    referenceNote: input.reference ? `A ${input.referencePurpose} reference image is attached. Keep its medium and the relevant person or room.` : "No reference image is attached.",
    rules: input.rules,
  });
  const revised = input.fix ? `${prompt}\n\nFix only this: ${input.fix}` : prompt;
  const id = crypto.randomUUID();
  const metadata: AssetMetadata = {
    qualityMode: input.mode,
    apiQuality: api.quality,
    resolution: api.resolution,
    attempt: input.attempt,
    referenceAssetIds: input.reference ? [input.reference.id] : [],
    referencesSent: 0,
  };
  insertAsset(db, {
    id,
    packId: input.packId,
    sceneId: input.sceneId,
    conceptId: input.conceptId,
    organisationId: input.organisationId,
    projectId: null,
    role: input.role,
    prompt: revised,
    aspectRatio: "9:16",
    parentId: null,
    version: nextVersion(db, null),
    status: input.attempt > 1 ? "REGENERATING" : "GENERATING",
    metadata,
  });
  const references: ImageReference[] = input.reference ? [{ assetId: input.reference.id, bytes: input.reference.bytes, mimeType: input.reference.mimeType }] : [];
  const provider = imageProvider();
  const result = await provider.generate({ prompt: revised, aspectRatio: "9:16", references, quality: api.quality, resolution: api.resolution });
  const sent = references.length > 0 && result.ok;
  if (input.reference) {
    db.prepare(`INSERT INTO generation_references (id, asset_id, reference_asset_id, purpose, provider, sent, detail, created_at) VALUES (?, ?, ?, ?, 'xai', ?, ?, ?)`).run(
      crypto.randomUUID(),
      id,
      input.reference.id,
      input.referencePurpose,
      sent ? 1 : 0,
      result.ok ? "The edit endpoint accepted the reference with the prompt." : result.message,
      new Date().toISOString(),
    );
  }
  if (!result.ok) {
    updateAsset(db, id, { status: "FAILED", provider: provider.id, model: provider.model, errorMessage: result.message, metadata });
    return { asset: null, ref: null, qa: "unresolved", reason: result.message };
  }
  const sniffed = sniffImage(result.bytes);
  const stored = localAssetStorage().write(id, result.bytes, sniffed.mimeType);
  const price = imageListPrice(result.model, references.length > 0);
  const ready: AssetMetadata = {
    ...metadata,
    referencesSent: sent ? 1 : 0,
    costUsd: price.costUsd,
    costBasis: price.costBasis,
    costStatus: price.costStatus,
    qa: "unresolved",
  };
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
    metadata: ready,
  });
  const images = [{ bytes: result.bytes, mimeType: stored.mimeType, label: "Generated image to judge." }];
  if (input.compare?.storage_location) {
    const prior = localAssetStorage().read(input.compare.storage_location);
    if (prior) images.push({ bytes: prior, mimeType: input.compare.mime_type || "image/jpeg", label: "Previous frame for continuity. Match identity, required wardrobe, world, side, and story state. Allow gaze, expression, hands, and posture to change. Do not fail a deliberate time jump. Do not fail a pose change unless the brief says the exact pose must remain frozen." });
  }
  const critique = await critiqueImage({ images, brief: input.brief });
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
  const asset = db.prepare(`SELECT * FROM generated_assets WHERE id = ?`).get(id) as AssetRow;
  if (!critique.ok) {
    updateAsset(db, id, { status: "NEEDS_HAYDEN", metadata: ready, errorMessage: critique.message ?? "The critic could not see the image." });
    return { asset, ref: { id, bytes: result.bytes, mimeType: stored.mimeType }, qa: "unresolved", reason: critique.message ?? "The critic could not see the image." };
  }
  if (fails.length === 0) {
    updateAsset(db, id, { status: "NEEDS_HAYDEN", metadata: { ...ready, qa: "pass" }, errorMessage: null });
    if (input.kind !== "scene") {
      db.prepare(`INSERT INTO visual_anchors (id, asset_id, concept_id, organisation_id, brand, kind, subject, liked, reuse, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'run', ?)`).run(
        crypto.randomUUID(),
        id,
        input.conceptId,
        input.organisationId,
        input.brand,
        input.kind,
        input.shot.subject,
        "Passed visual QA for this run. Not a durable brand rule until Hayden approves it.",
        input.kind,
        new Date().toISOString(),
      );
    }
    return { asset: { ...asset, storage_location: stored.absolutePath, mime_type: stored.mimeType }, ref: { id, bytes: result.bytes, mimeType: stored.mimeType }, qa: "pass", reason: "passed" };
  }
  const reason = `${fails.join(", ")} failed. ${critique.summary}`;
  if (input.settings.auto_regen && input.attempt <= input.settings.max_retries) {
    updateAsset(db, id, { status: "AI_QA_FAILED", errorMessage: reason, metadata: ready });
    return makeFrame(db, { ...input, fix: critique.regenerationPlan || reason, attempt: input.attempt + 1 });
  }
  updateAsset(db, id, { status: "NEEDS_HAYDEN", errorMessage: reason, metadata: ready });
  return { asset, ref: { id, bytes: result.bytes, mimeType: stored.mimeType }, qa: "unresolved", reason: `Attempt ${input.attempt} stopped. ${reason}` };
}

export function recordVisualFeedback(db: Database.Database, assetId: string, note: string) {
  const asset = db.prepare(`SELECT * FROM generated_assets WHERE id = ?`).get(assetId) as AssetRow | undefined;
  if (!asset) throw new Error("That image is not stored.");
  const category = feedbackCategory(note);
  db.prepare(`INSERT INTO visual_feedback (id, asset_id, concept_id, organisation_id, brand, model, note, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(),
    asset.id,
    asset.concept_id,
    asset.organisation_id,
    null,
    asset.model,
    note.trim(),
    category,
    new Date().toISOString(),
  );
  const same = db.prepare(`SELECT COUNT(*) AS n FROM visual_feedback WHERE organisation_id = ? AND category = ?`).get(asset.organisation_id, category) as { n: number };
  if (asset.organisation_id && same.n >= 3 && category === "TOO PHOTOREAL") {
    suggestVisualRule(db, {
      organisationId: asset.organisation_id,
      key: "prefer-stylised",
      title: "Stylised imagery may fit better",
      body: "Repeated rejections mentioned photoreal or corporate polish. This is a suggestion, not a rule, until Hayden approves it.",
    });
  }
  return asset;
}

export async function regenerateWithNote(db: Database.Database, assetId: string, note: string) {
  const asset = recordVisualFeedback(db, assetId, note);
  if (!asset.prompt) throw new Error("That frame has no stored prompt.");
  const id = crypto.randomUUID();
  insertAsset(db, {
    id,
    packId: asset.production_pack_id ?? "",
    sceneId: asset.scene_id,
    conceptId: asset.concept_id,
    organisationId: asset.organisation_id,
    projectId: asset.project_id,
    role: asset.asset_role as AssetRole,
    prompt: `${asset.prompt}\n\nHayden's note: ${note.trim()}. Keep the scene. Change only that.`,
    aspectRatio: asset.aspect_ratio || "9:16",
    parentId: asset.id,
    version: nextVersion(db, asset.id),
    status: "REGENERATING",
    metadata: { feedback: note.trim(), attempt: (parseAssetAttempt(asset.metadata) ?? 1) + 1 },
  });
  const provider = imageProvider();
  const prior = db
    .prepare(`SELECT reference_asset_id, purpose FROM generation_references WHERE asset_id = ? AND sent = 1 ORDER BY created_at DESC LIMIT 1`)
    .get(asset.id) as { reference_asset_id: string; purpose: string } | undefined;
  const priorAsset = prior
    ? (db.prepare(`SELECT storage_location, mime_type FROM generated_assets WHERE id = ?`).get(prior.reference_asset_id) as
        | { storage_location: string | null; mime_type: string | null }
        | undefined)
    : undefined;
  const priorBytes = priorAsset?.storage_location ? localAssetStorage().read(priorAsset.storage_location) : null;
  const references = prior && priorBytes ? [{ assetId: prior.reference_asset_id, bytes: priorBytes, mimeType: priorAsset?.mime_type || "image/jpeg" }] : [];
  const result = await provider.generate({
    prompt: `${asset.prompt}\n\nHayden's note: ${note.trim()}. Keep the scene. Change only that.`,
    aspectRatio: asset.aspect_ratio || "9:16",
    references,
    quality: "medium",
    resolution: "1k",
  });
  if (!result.ok) {
    updateAsset(db, id, { status: "FAILED", errorMessage: result.message });
    throw new Error(result.message);
  }
  if (prior) {
    db.prepare(`INSERT INTO generation_references (id, asset_id, reference_asset_id, purpose, provider, sent, detail, created_at) VALUES (?, ?, ?, ?, 'xai', ?, ?, ?)`).run(
      crypto.randomUUID(),
      id,
      prior.reference_asset_id,
      prior.purpose,
      result.ok ? 1 : 0,
      "The edit endpoint accepted the reference with the prompt.",
      new Date().toISOString(),
    );
  }
  const sniffed = sniffImage(result.bytes);
  const stored = localAssetStorage().write(id, result.bytes, sniffed.mimeType);
  updateAsset(db, id, {
    status: "NEEDS_HAYDEN",
    provider: provider.id,
    model: result.model,
    width: result.width ?? sniffed.width,
    height: result.height ?? sniffed.height,
    storageLocation: stored.absolutePath,
    fileName: stored.fileName,
    mimeType: stored.mimeType,
    fileSize: stored.fileSize,
    completedAt: new Date().toISOString(),
    errorMessage: "Hayden asked for a change. This version has not passed visual QA.",
    metadata: { feedback: note.trim(), qa: "unresolved", attempt: (parseAssetAttempt(asset.metadata) ?? 1) + 1 },
  });
  return id;
}

function feedbackCategory(note: string) {
  const text = note.toLowerCase();
  if (/too ai|synthetic|hdr glow|glossy|plastic skin|ai polish/.test(text)) return "AI_POLISH";
  if (/corporate/.test(text)) return "TOO CORPORATE";
  if (/photo|real/.test(text)) return "TOO PHOTOREAL";
  if (/cartoon/.test(text)) return "TOO CARTOONY";
  if (/funny|joke/.test(text)) return "NOT FUNNY";
  if (/character/.test(text)) return "WRONG CHARACTER";
  if (/generic|stock/.test(text)) return "GENERIC";
  return "OTHER";
}

function parseAssetAttempt(raw: string | null) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { attempt?: number };
    return value.attempt ?? null;
  } catch {
    return null;
  }
}

function visualSettings(db: Database.Database): Settings {
  return (
    (db.prepare(`SELECT auto_regen, max_retries, hero_candidates FROM visual_settings WHERE id = 'hayden'`).get() as Settings | undefined) ?? {
      auto_regen: 1,
      max_retries: 2,
      hero_candidates: 1,
    }
  );
}

function anchorShot(medium: string | null, device: string | null, motif: string | null): ShotSlice {
  return {
    scene_number: 0,
    role: "hero",
    story_purpose: "Show the visual world in one frame.",
    visual_joke: device,
    subject: "The two people from the concept.",
    action: device,
    composition: motif,
    camera_position: "Straight on",
    camera_height: "Eye level",
    shot_size: "Medium",
    lens_feeling: "Normal",
    lighting: medium && /sketch|illustrat/i.test(medium) ? "Drawn light, not a photograph." : "Light for the locked medium.",
    colour: null,
    environment: "Only what this anchor needs.",
    props: null,
    expression: null,
    readable: motif,
    continuity_dependency: "This image is the anchor.",
    must_not_appear: "Photoreal live action, logo, speech bubble, readable contract.",
  };
}

function criticBrief(
  lock: { brand: string; visual_medium: string | null; core_device: string | null; required_motif: string | null; forbidden_changes: string | null },
  style: StyleProfile,
  extra: string,
) {
  return `Brand: ${lock.brand}
Medium: ${lock.visual_medium}
Style: ${style.style_name}. ${style.style_description ?? ""}
Device: ${lock.core_device}
Required: ${lock.required_motif}
Forbidden: ${lock.forbidden_changes}
Negatives: ${style.negative_style_constraints ?? ""}
${extra}
If the medium is a sketch and the image is photoreal, STYLE MATCH is FAIL.
If a split is required and you cannot see a left/right split, COMPOSITION is FAIL.
Continuity means the same recognisable person, required wardrobe, required world, correct side, important props, and story state. A stagnant life is not a frozen pose. Gaze, expression, hands, and posture may change unless the lock says the exact pose must remain frozen.`;
}
