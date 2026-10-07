import type Database from "better-sqlite3";
import { activeRules } from "@/lib/factory/defaults";
import { modelCapability } from "@/lib/factory/models";
import { saveProductionPack, type PackDraft, type SceneDraft } from "@/lib/factory/store";
import { CAPABILITY_FIELDS, FRAME_TYPES, PRODUCTION_TYPES, type CapabilityField, type ProductionType } from "@/lib/factory/types";
import { asText, draft, parseModelJson } from "@/lib/team/draft";
import { photographicConflict } from "@/lib/visual/compiler";
import { getIntent } from "@/lib/visual/intent";
import { productionBlock } from "@/lib/content/workflow";

type JobSlice = { id: string; objective: string; organisation_id: string | null };
type ContextSlice = { text: string; organisationName: string | null; brainTitles: string[] };

const TYPES = new Set<string>(PRODUCTION_TYPES.map(([id]) => id));

export async function runContentFactory(db: Database.Database, job: JobSlice, context: ContextSlice) {
  const capabilityAsk = askedCapability(job.objective);
  if (capabilityAsk) {
    const value = modelCapability(db, capabilityAsk.model, capabilityAsk.field);
    return {
      summary: `${capabilityAsk.model} ${capabilityAsk.field.replaceAll("_", " ")}: ${value}.`,
      findings: value === "UNKNOWN" ? "That capability has not been configured or verified." : "Stored on the model profile.",
      recommendations: "Leave unknown capabilities unknown. Do not invent model support.",
      confidence: "high",
      evidence: "production_model_profiles",
      model: null,
      inputTokens: null,
      outputTokens: null,
      requiresHayden: false,
    };
  }

  const conceptId = /concept:([0-9a-f-]{16,})/i.exec(job.objective)?.[1] ?? null;
  if (!conceptId) {
    return {
      summary: "Content Factory needs an approved concept. It does not invent the idea.",
      findings: "No concept id was attached to this job.",
      recommendations: "Approve a concept, then send it to Content Factory.",
      confidence: "high",
      evidence: "creative_concepts",
      model: null,
      inputTokens: null,
      outputTokens: null,
      requiresHayden: false,
    };
  }
  const concept = db.prepare(`SELECT * FROM creative_concepts WHERE id = ?`).get(conceptId) as
    | {
        id: string;
        title: string;
        brand: string | null;
        hook: string | null;
        concept: string | null;
        format: string | null;
        script_outline: string | null;
        visual_direction: string | null;
        audience: string | null;
        cta: string | null;
        organisation_id: string | null;
        status: string;
      }
    | undefined;
  if (!concept) {
    return blocked("That concept is not in the library.");
  }
  const override = /override:unapproved/.test(job.objective);
  if (concept.status !== "approved" && !override) {
    return {
      summary: "This concept has not been approved.",
      findings: `Status is ${concept.status}. Content Factory did not write a pack.`,
      recommendations: "Approve it, or send it again with an explicit override.",
      confidence: "high",
      evidence: "creative_concepts",
      model: null,
      inputTokens: null,
      outputTokens: null,
      requiresHayden: true,
    };
  }
  const held = productionBlock(db, concept.id);
  if (held) return blocked(held);
  const rules = activeRules(db, { organisationId: concept.organisation_id, modelProfileId: null });
  const lock = getIntent(db, concept.id);
  if (lock && lock.brand !== "UNKNOWN BRAND") concept.brand = lock.brand;
  const drafted = await draft(factorySystem(concept.brand, rules.map((rule) => rule.body), lock), factoryUser(concept, context.text), 0.3, 240000);
  if (!drafted.ok) {
    const message = /timeout|aborted|abort/i.test(drafted.message ?? "")
      ? "The model took too long and the pack was not saved."
      : drafted.message || "The model did not answer.";
    return {
      summary: `Content Factory did not store a pack. ${message}`,
      findings: message,
      recommendations: "Send the same concept again.",
      confidence: "low",
      evidence: context.brainTitles.join(", ") || "Stored brand notes",
      model: drafted.model,
      inputTokens: drafted.inputTokens,
      outputTokens: drafted.outputTokens,
      requiresHayden: false,
    };
  }
  const parsed = parseModelJson(drafted.text);
  const packDraft = normalisePack(parsed, concept.format);
  if (lock && photographicConflict(lock.visual_medium, `${packDraft.globalVisualDirection ?? ""} ${packDraft.productionType}`)) {
    const kept = packDraft.globalVisualDirection;
    packDraft.globalVisualDirection = `${lock.visual_medium}. ${lock.forbidden_changes}`;
    db.prepare(`INSERT INTO production_conflicts (id, concept_id, summary, status, created_at) VALUES (?, ?, ?, 'open', ?)`).run(
      crypto.randomUUID(),
      concept.id,
      `Content Factory tried to change the locked medium. Kept: ${lock.visual_medium}. Ignored photographic wording from: ${(kept ?? packDraft.productionType).slice(0, 240)}`,
      new Date().toISOString(),
    );
  }
  if (packDraft.scenes.length === 0) {
    return {
      summary: "Content Factory did not store a pack. The model did not return usable scenes, and none were invented.",
      findings: "No scenes.",
      recommendations: "Run it again once the model returns a scene list.",
      confidence: "low",
      evidence: context.brainTitles.join(", ") || "Stored brand notes",
      model: drafted.model,
      inputTokens: drafted.inputTokens,
      outputTokens: drafted.outputTokens,
      requiresHayden: false,
    };
  }
  const saved = saveProductionPack(db, { concept, draft: packDraft, jobId: job.id, override: override && concept.status !== "approved" });
  const issueCount = saved.continuity.length + saved.durationIssues.length;
  return {
    summary:
      issueCount > 0
        ? `Content Factory drafted a pack for ${concept.title}. Continuity or duration issues are on the pack. Nothing has been produced.`
        : `Content Factory drafted a pack for ${concept.title}. It is instructions for a person. Nothing has been produced.`,
    findings: `Pack ${saved.id}. Status ${saved.status}. Continuity ${saved.continuity.length === 0 ? "pass" : "issues found"}.`,
    recommendations: issueCount > 0 ? "Fix the flagged scenes before assignment." : "Hayden can review the pack, then assign Lily or Danny.",
    confidence: context.brainTitles.length > 0 ? "medium" : "low",
    evidence: context.brainTitles.join(", ") || "Stored brand notes",
    model: drafted.model,
    inputTokens: drafted.inputTokens,
    outputTokens: drafted.outputTokens,
    requiresHayden: issueCount > 0,
  };
}

function blocked(summary: string) {
  return {
    summary,
    findings: "No pack stored.",
    recommendations: "Choose a concept from the library.",
    confidence: "high",
    evidence: "creative_concepts",
    model: null,
    inputTokens: null,
    outputTokens: null,
    requiresHayden: false,
  };
}

function askedCapability(objective: string): { model: string; field: CapabilityField } | null {
  const text = objective.toLowerCase();
  if (!/capabilit|does .+ support|audio support|dialogue support|start\/end|start frames/.test(text)) return null;
  const model = ["veo", "kling", "omni flash", "omni-flash", "other"].find((name) => text.includes(name));
  if (!model) return null;
  const field = CAPABILITY_FIELDS.find((item) => text.includes(item.replaceAll("_", " "))) ?? inferField(text);
  return { model: model.replace(" ", "-"), field };
}

function inferField(text: string): CapabilityField {
  if (/audio/.test(text)) return "audio_support";
  if (/dialogue|lipsync|lip-sync/.test(text)) return "dialogue_support";
  if (/start frame|end frame|start\/end/.test(text)) return "start_end_frames";
  if (/aspect/.test(text)) return "aspect_ratios";
  if (/duration/.test(text)) return "allowed_durations";
  return "known_limitations";
}

function factorySystem(
  brand: string | null,
  rules: string[],
  lock?: { visual_medium: string | null; forbidden_changes: string | null; required_motif: string | null; core_device: string | null } | null,
) {
  return `You are Content Factory, the production director inside Hayden OS.
You do not change the locked visual medium, format, core device, or characters.
${lock ? `LOCKED MEDIUM: ${lock.visual_medium}. REQUIRED: ${lock.required_motif}. DEVICE: ${lock.core_device}. FORBIDDEN: ${lock.forbidden_changes}.` : ""}
You convert ONE approved concept into a production pack. You do not change the strategy or invent a new concept.
Brand: ${brand ?? "UNKNOWN BRAND"}.
Use only the operating context for this brand.
Choose one production type from: ${PRODUCTION_TYPES.map(([id]) => id).join(", ")}.
Do not assume AI video. Use street_interview, image_ad, carousel, ugc, motion_graphics, claymation, photorealistic_ai_video, hybrid, or ai_video only when the concept calls for it.
For ai_video, photorealistic_ai_video, claymation and hybrid, every scene needs a start frame and an end frame. The end frame must support the next start frame.
Voice, if the brand is Australian: choose one that fits the stored brand context. Options include natural Australian, everyday, dry humour, understated, tradie, professional, older Australian, younger Australian. Do not use a commercial announcer. Do not give every brand the same voice.
Do not claim a video, image, or file was produced.
Do not invent model capabilities. If the model is named, still treat unverified technical support as unknown.
Founder production preferences, unless a later rule replaces them:
${rules.map((rule) => `- ${rule}`).join("\n")}
Return JSON only:
{"productionType":"ai_video","aspectRatio":"9:16","targetDuration":"18 seconds","voiceDirection":"","globalVisualDirection":"","characters":[{"name":"","appearance":"","hair":"","clothing":"","accessories":"","personality":"","voice":"","accent":"","bodyLanguage":"","referenceNotes":""}],"locations":[{"name":"","description":""}],"continuityRules":"","editingNotes":"","musicDirection":"","soundDirection":"","onScreenText":"","cta":"","disclaimers":"","generationModel":null,"scenes":[{"sceneNumber":1,"durationSeconds":6,"objective":"","visual":"","action":"","characters":"","location":"","camera":"","startFrame":"","endFrame":"","voiceover":"","speaker":"","sfx":"","musicNotes":"","onScreenText":"","continuityFrom":"","continuityInto":"","productionNotes":""}]}`;
}

function factoryUser(
  concept: { title: string; hook: string | null; concept: string | null; format: string | null; script_outline: string | null; visual_direction: string | null; audience: string | null; cta: string | null },
  context: string,
) {
  return `Concept title: ${concept.title}
Hook: ${concept.hook ?? ""}
Idea: ${concept.concept ?? ""}
Format: ${concept.format ?? ""}
Outline: ${concept.script_outline ?? ""}
Visual: ${concept.visual_direction ?? ""}
Audience: ${concept.audience ?? ""}
CTA: ${concept.cta ?? ""}

Operating context:
${context}`;
}

function normalisePack(parsed: Record<string, unknown> | null, format: string | null): PackDraft {
  const requested = asText(parsed?.productionType, inferType(format));
  const productionType = (TYPES.has(requested) ? requested : inferType(format)) as ProductionType;
  const scenes = Array.isArray(parsed?.scenes) ? parsed.scenes.map((scene, index) => normaliseScene(scene, index + 1)).filter((scene) => scene.objective || scene.voiceover || scene.startFrame || scene.action) : [];
  if (FRAME_TYPES.has(productionType)) {
    for (const scene of scenes) {
      if (!scene.sfx.trim()) scene.sfx = "";
      if (!scene.musicNotes.trim()) scene.musicNotes = "";
    }
  }
  return {
    productionType,
    aspectRatio: asText(parsed?.aspectRatio) || null,
    targetDuration: asText(parsed?.targetDuration) || null,
    voiceDirection: asText(parsed?.voiceDirection) || "Match the stored brand. Do not default every brand to the same voice.",
    globalVisualDirection: asText(parsed?.globalVisualDirection) || null,
    characterBible: JSON.stringify(Array.isArray(parsed?.characters) ? parsed.characters : []),
    locationBible: JSON.stringify(Array.isArray(parsed?.locations) ? parsed.locations : []),
    continuityRules: asText(parsed?.continuityRules) || null,
    editingNotes: asText(parsed?.editingNotes) || null,
    musicDirection: asText(parsed?.musicDirection) || null,
    soundDirection: asText(parsed?.soundDirection) || null,
    onScreenText: asText(parsed?.onScreenText) || null,
    cta: asText(parsed?.cta) || null,
    disclaimers: asText(parsed?.disclaimers) || null,
    generationModel: asText(parsed?.generationModel) || null,
    modelProfileId: null,
    scenes,
  };
}

function normaliseScene(value: unknown, fallbackNumber: number): SceneDraft {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const duration = Number(item.durationSeconds);
  return {
    sceneNumber: Number(item.sceneNumber) || fallbackNumber,
    durationSeconds: Number.isFinite(duration) ? duration : null,
    objective: asText(item.objective),
    visual: asText(item.visual),
    action: asText(item.action),
    characters: asText(item.characters),
    location: asText(item.location),
    camera: asText(item.camera),
    startFrame: asText(item.startFrame),
    endFrame: asText(item.endFrame),
    voiceover: asText(item.voiceover),
    speaker: asText(item.speaker, "Voiceover"),
    sfx: asText(item.sfx),
    musicNotes: asText(item.musicNotes),
    onScreenText: asText(item.onScreenText),
    continuityFrom: asText(item.continuityFrom),
    continuityInto: asText(item.continuityInto),
    productionNotes: asText(item.productionNotes),
  };
}

function inferType(format: string | null): ProductionType {
  const text = (format ?? "").toLowerCase();
  if (/street/.test(text)) return "street_interview";
  if (/carousel/.test(text)) return "carousel";
  if (/image|static/.test(text)) return "image_ad";
  if (/ugc/.test(text)) return "ugc";
  if (/clay/.test(text)) return "claymation";
  if (/motion/.test(text)) return "motion_graphics";
  if (/hybrid/.test(text)) return "hybrid";
  if (/photo/.test(text)) return "photorealistic_ai_video";
  if (/video/.test(text)) return "ai_video";
  return "hybrid";
}
