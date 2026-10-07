import type Database from "better-sqlite3";
import { checkContinuity } from "@/lib/factory/continuity";
import { activeRules } from "@/lib/factory/defaults";
import { estimateSpokenSeconds, validateDuration } from "@/lib/factory/duration";
import { activeExecutor } from "@/lib/factory/executor";
import { composeScenePrompt } from "@/lib/factory/prompt";
import { FRAME_TYPES, type PackStatus, type ProductionType } from "@/lib/factory/types";

export type SceneDraft = {
  sceneNumber: number;
  durationSeconds: number | null;
  objective: string;
  visual: string;
  action: string;
  characters: string;
  location: string;
  camera: string;
  startFrame: string;
  endFrame: string;
  voiceover: string;
  speaker: string;
  sfx: string;
  musicNotes: string;
  onScreenText: string;
  continuityFrom: string;
  continuityInto: string;
  productionNotes: string;
};

export type PackDraft = {
  productionType: ProductionType;
  aspectRatio: string | null;
  targetDuration: string | null;
  voiceDirection: string | null;
  globalVisualDirection: string | null;
  characterBible: string;
  locationBible: string;
  continuityRules: string | null;
  editingNotes: string | null;
  musicDirection: string | null;
  soundDirection: string | null;
  onScreenText: string | null;
  cta: string | null;
  disclaimers: string | null;
  generationModel: string | null;
  modelProfileId: string | null;
  scenes: SceneDraft[];
};

type ConceptRef = {
  id: string;
  title: string;
  brand: string | null;
  hook: string | null;
  concept: string | null;
  organisation_id: string | null;
  status: string;
};

export type PackRow = {
  id: string;
  root_id: string;
  version: number;
  supersedes_id: string | null;
  creative_concept_id: string | null;
  organisation_id: string | null;
  project_id: string | null;
  brand: string | null;
  production_type: string;
  aspect_ratio: string | null;
  target_duration: string | null;
  number_of_scenes: number;
  production_owner: string | null;
  assigned_at: string | null;
  due_date: string | null;
  status: string;
  script: string | null;
  voice_direction: string | null;
  global_visual_direction: string | null;
  character_bible: string | null;
  location_bible: string | null;
  continuity_rules: string | null;
  editing_notes: string | null;
  music_direction: string | null;
  sound_direction: string | null;
  on_screen_text: string | null;
  cta: string | null;
  disclaimers: string | null;
  generation_model: string | null;
  model_profile_id: string | null;
  continuity_status: string | null;
  continuity_report: string | null;
  duration_report: string | null;
  checklist: string | null;
  unapproved_override: number;
  executor: string;
  created_by: string;
  approved_by: string | null;
  job_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SceneRow = {
  id: string;
  pack_id: string;
  scene_number: number;
  duration_seconds: number | null;
  objective: string | null;
  visual: string | null;
  action: string | null;
  characters: string | null;
  location: string | null;
  camera: string | null;
  start_frame: string | null;
  end_frame: string | null;
  video_prompt: string | null;
  voiceover: string | null;
  speaker: string | null;
  sfx: string | null;
  music_notes: string | null;
  on_screen_text: string | null;
  continuity_from: string | null;
  continuity_into: string | null;
  production_notes: string | null;
};

const EMPTY_CHECKLIST = {
  assetsCreated: false,
  scenesGenerated: false,
  voComplete: false,
  editComplete: false,
  readyForReview: false,
};

export function saveProductionPack(
  db: Database.Database,
  input: {
    concept: ConceptRef;
    draft: PackDraft;
    jobId: string | null;
    override: boolean;
    supersedesId?: string | null;
    rootId?: string | null;
    version?: number;
  },
) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const rules = activeRules(db, {
    organisationId: input.concept.organisation_id,
    projectId: null,
    modelProfileId: input.draft.modelProfileId,
  });
  const constraints = rules.map((rule) => rule.body);
  const requireFrames = FRAME_TYPES.has(input.draft.productionType);
  const scenes = input.draft.scenes.map((scene) => ({
    ...scene,
    prompt: composeScenePrompt({
      scene: {
        sceneNumber: scene.sceneNumber,
        durationSeconds: scene.durationSeconds,
        visual: scene.visual,
        action: scene.action,
        characters: scene.characters,
        location: scene.location,
        camera: scene.camera,
        startFrame: scene.startFrame,
        endFrame: scene.endFrame,
        voiceover: scene.voiceover,
        sfx: scene.sfx,
        musicNotes: scene.musicNotes,
        continuityFrom: scene.continuityFrom,
        continuityInto: scene.continuityInto,
      },
      productionType: input.draft.productionType,
      aspectRatio: input.draft.aspectRatio,
      visualStyle: input.draft.globalVisualDirection,
      voiceDirection: input.draft.voiceDirection,
      constraints,
    }),
  }));
  const continuity = checkContinuity(
    scenes.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      startFrame: scene.startFrame,
      endFrame: scene.endFrame,
      location: scene.location,
      continuityFrom: scene.continuityFrom,
      continuityInto: scene.continuityInto,
    })),
    { requireFrames },
  );
  const duration = scenes.map((scene) => {
    const result = validateDuration({ durationSeconds: scene.durationSeconds ?? 0, dialogue: scene.voiceover });
    return { scene: scene.sceneNumber, ...result };
  });
  const durationIssues = duration.filter((item) => !item.ok && item.sceneDuration > 0 && item.estimatedSeconds > 0);
  const ready = continuity.length === 0 && durationIssues.length === 0 && scenes.length > 0;
  const script = masterScript(input.concept.title, scenes);
  db.prepare(
    `INSERT INTO production_packs (
      id, root_id, version, supersedes_id, creative_concept_id, organisation_id, brand, production_type,
      aspect_ratio, target_duration, number_of_scenes, status, script, voice_direction, global_visual_direction,
      character_bible, location_bible, continuity_rules, editing_notes, music_direction, sound_direction,
      on_screen_text, cta, disclaimers, generation_model, model_profile_id, continuity_status, continuity_report,
      duration_report, checklist, unapproved_override, executor, created_by, job_id, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'content', ?, ?, ?
    )`,
  ).run(
    id,
    input.rootId ?? id,
    input.version ?? 1,
    input.supersedesId ?? null,
    input.concept.id || null,
    input.concept.organisation_id,
    input.concept.brand,
    input.draft.productionType,
    input.draft.aspectRatio,
    input.draft.targetDuration,
    scenes.length,
    ready ? "needs_review" : "draft",
    script,
    input.draft.voiceDirection,
    input.draft.globalVisualDirection,
    input.draft.characterBible,
    input.draft.locationBible,
    input.draft.continuityRules,
    input.draft.editingNotes,
    input.draft.musicDirection,
    input.draft.soundDirection,
    input.draft.onScreenText,
    input.draft.cta,
    input.draft.disclaimers,
    input.draft.generationModel,
    input.draft.modelProfileId,
    continuity.length === 0 ? "pass" : "issues_found",
    JSON.stringify(continuity),
    JSON.stringify(duration),
    JSON.stringify(EMPTY_CHECKLIST),
    input.override ? 1 : 0,
    activeExecutor().id,
    input.jobId,
    now,
    now,
  );
  const insertScene = db.prepare(
    `INSERT INTO production_scenes (
      id, pack_id, scene_number, duration_seconds, objective, visual, action, characters, location, camera,
      start_frame, end_frame, video_prompt, voiceover, speaker, sfx, music_notes, on_screen_text,
      continuity_from, continuity_into, production_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const scene of scenes) {
    insertScene.run(
      crypto.randomUUID(),
      id,
      scene.sceneNumber,
      scene.durationSeconds,
      scene.objective,
      scene.visual,
      scene.action,
      scene.characters,
      scene.location,
      scene.camera,
      scene.startFrame,
      scene.endFrame,
      scene.prompt,
      scene.voiceover,
      scene.speaker,
      scene.sfx,
      scene.musicNotes,
      scene.onScreenText,
      scene.continuityFrom,
      scene.continuityInto,
      scene.productionNotes,
    );
  }
  if (input.concept.id) {
    db.prepare(`UPDATE creative_concepts SET production_status = 'pack_drafted' WHERE id = ?`).run(input.concept.id);
  }
  return { id, continuity, durationIssues, status: ready ? "needs_review" : "draft" };
}

export function listScenes(db: Database.Database, packId: string) {
  return db.prepare(`SELECT * FROM production_scenes WHERE pack_id = ? ORDER BY scene_number`).all(packId) as SceneRow[];
}

export function getPack(db: Database.Database, id: string) {
  return db.prepare(`SELECT * FROM production_packs WHERE id = ?`).get(id) as PackRow | undefined;
}

export function listPacks(
  db: Database.Database,
  filters: { brand?: string; owner?: string; productionType?: string; model?: string; status?: string; project?: string },
) {
  const clauses = [`NOT EXISTS (SELECT 1 FROM production_packs newer WHERE newer.supersedes_id = production_packs.id)`];
  const values: string[] = [];
  if (filters.brand) {
    clauses.push(`brand = ?`);
    values.push(filters.brand);
  }
  if (filters.owner) {
    clauses.push(`production_owner = ?`);
    values.push(filters.owner);
  }
  if (filters.productionType) {
    clauses.push(`production_type = ?`);
    values.push(filters.productionType);
  }
  if (filters.model) {
    clauses.push(`(generation_model = ? OR model_profile_id = ?)`);
    values.push(filters.model, filters.model);
  }
  if (filters.status) {
    clauses.push(`status = ?`);
    values.push(filters.status);
  }
  if (filters.project) {
    clauses.push(`project_id = ?`);
    values.push(filters.project);
  }
  return db.prepare(`SELECT * FROM production_packs WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC`).all(...values) as PackRow[];
}

export function packVersions(db: Database.Database, rootId: string) {
  return db.prepare(`SELECT id, version, status, created_at FROM production_packs WHERE root_id = ? ORDER BY version`).all(rootId) as Array<{
    id: string;
    version: number;
    status: string;
    created_at: string;
  }>;
}

export function executionView(db: Database.Database, packId: string) {
  const pack = getPack(db, packId);
  if (!pack) return null;
  const concept = pack.creative_concept_id
    ? (db.prepare(`SELECT title, hook, concept FROM creative_concepts WHERE id = ?`).get(pack.creative_concept_id) as
        | { title: string; hook: string | null; concept: string | null }
        | undefined)
    : undefined;
  return {
    what: concept?.title ?? pack.brand ?? "Production pack",
    reference: [concept?.hook, concept?.concept].filter(Boolean).join(" "),
    script: pack.script,
    style: pack.global_visual_direction,
    voice: pack.voice_direction,
    productionType: pack.production_type,
    aspectRatio: pack.aspect_ratio,
    scenes: listScenes(db, packId).map((scene) => ({
      number: scene.scene_number,
      startFrame: scene.start_frame,
      endFrame: scene.end_frame,
      prompt: scene.video_prompt,
      voiceover: scene.voiceover,
      sfx: scene.sfx,
      notes: scene.production_notes,
      durationSeconds: scene.duration_seconds,
    })),
    checklist: JSON.parse(pack.checklist || "{}") as typeof EMPTY_CHECKLIST,
    continuityStatus: pack.continuity_status,
    executor: pack.executor,
  };
}

export function assignPack(db: Database.Database, packId: string, owner: "lily" | "danny", dueDate: string | null) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE production_packs SET production_owner = ?, assigned_at = ?, due_date = ?, status = 'assigned', updated_at = ? WHERE id = ?`,
  ).run(owner, now, dueDate || null, now, packId);
}

export function setPackStatus(db: Database.Database, packId: string, status: PackStatus, approvedBy?: string | null) {
  const now = new Date().toISOString();
  if (status === "complete") {
    const pack = getPack(db, packId);
    const checklist = JSON.parse(pack?.checklist || "{}") as { readyForReview?: boolean };
    if (!checklist.readyForReview) throw new Error("A person has to mark the pack ready for review before it can be complete.");
  }
  db.prepare(`UPDATE production_packs SET status = ?, approved_by = COALESCE(?, approved_by), updated_at = ? WHERE id = ?`).run(
    status,
    approvedBy ?? null,
    now,
    packId,
  );
}

export function updateChecklist(db: Database.Database, packId: string, checklist: typeof EMPTY_CHECKLIST) {
  const now = new Date().toISOString();
  const status = checklist.readyForReview ? "ready_for_review" : null;
  db.prepare(`UPDATE production_packs SET checklist = ?, updated_at = ?, status = COALESCE(?, status) WHERE id = ?`).run(
    JSON.stringify(checklist),
    now,
    status,
    packId,
  );
}

export function recordFeedback(
  db: Database.Database,
  input: { packId: string; sceneId: string | null; modelProfileId: string | null; kind: string; note: string; createdBy: string },
) {
  db.prepare(
    `INSERT INTO production_feedback (id, pack_id, scene_id, model_profile_id, kind, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), input.packId, input.sceneId, input.modelProfileId, input.kind, input.note.trim(), input.createdBy, new Date().toISOString());
}

export function revisePack(db: Database.Database, packId: string, note: string, jobId: string | null) {
  const pack = getPack(db, packId);
  if (!pack) throw new Error("That production pack is not stored.");
  const scenes = listScenes(db, packId);
  const concept = {
    id: pack.creative_concept_id ?? "",
    title: pack.brand ?? "Revision",
    brand: pack.brand,
    hook: null,
    concept: null,
    organisation_id: pack.organisation_id,
    status: "approved",
  };
  const saved = saveProductionPack(db, {
    concept,
    jobId,
    override: pack.unapproved_override === 1,
    supersedesId: pack.id,
    rootId: pack.root_id,
    version: pack.version + 1,
    draft: {
      productionType: pack.production_type as ProductionType,
      aspectRatio: pack.aspect_ratio,
      targetDuration: pack.target_duration,
      voiceDirection: pack.voice_direction,
      globalVisualDirection: pack.global_visual_direction,
      characterBible: pack.character_bible ?? "[]",
      locationBible: pack.location_bible ?? "[]",
      continuityRules: pack.continuity_rules,
      editingNotes: pack.editing_notes,
      musicDirection: pack.music_direction,
      soundDirection: pack.sound_direction,
      onScreenText: pack.on_screen_text,
      cta: pack.cta,
      disclaimers: pack.disclaimers,
      generationModel: pack.generation_model,
      modelProfileId: pack.model_profile_id,
      scenes: scenes.map((scene) => ({
        sceneNumber: scene.scene_number,
        durationSeconds: scene.duration_seconds,
        objective: scene.objective ?? "",
        visual: scene.visual ?? "",
        action: scene.action ?? "",
        characters: scene.characters ?? "",
        location: scene.location ?? "",
        camera: scene.camera ?? "",
        startFrame: scene.start_frame ?? "",
        endFrame: scene.end_frame ?? "",
        voiceover: scene.voiceover ?? "",
        speaker: scene.speaker ?? "",
        sfx: scene.sfx ?? "",
        musicNotes: scene.music_notes ?? "",
        onScreenText: scene.on_screen_text ?? "",
        continuityFrom: scene.continuity_from ?? "",
        continuityInto: scene.continuity_into ?? "",
        productionNotes:
          scene.scene_number === 3 || (scenes.every((item) => item.scene_number !== 3) && scene.scene_number === scenes[scenes.length - 1]?.scene_number)
            ? `${scene.production_notes ?? ""}\nRevision: ${note}`.trim()
            : (scene.production_notes ?? ""),
      })),
    },
  });
  return saved;
}

function masterScript(title: string, scenes: Array<SceneDraft & { prompt: string }>) {
  const lines = scenes.map((scene) => {
    const check = validateDuration({ durationSeconds: scene.durationSeconds ?? 0, dialogue: scene.voiceover });
    const flag = check.ok ? "" : ` FLAG: ${check.message}`;
    return `Scene ${scene.sceneNumber} · ${scene.speaker || "Voiceover"} · ${scene.durationSeconds ?? "unset"}s\n${scene.voiceover || "No spoken line."}${flag}`;
  });
  const total = scenes.reduce((sum, scene) => sum + (scene.durationSeconds ?? 0), 0);
  return `${title}\n\n${lines.join("\n\n")}\n\nTotal estimated runtime: ${total} seconds.`;
}

export function spokenEstimate(text: string) {
  return estimateSpokenSeconds(text);
}
