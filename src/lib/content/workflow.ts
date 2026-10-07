import type Database from "better-sqlite3";
import { draft, parseModelJson, asText } from "@/lib/team/draft";
import { knownBrand } from "@/lib/visual/brand";
import { approvedVisualRules } from "@/lib/visual/brain";
import { styleById, styleCriticRules } from "@/lib/content/styles";

const WAITING = ["CONCEPT_REVIEW", "SCRIPT_REVIEW", "STYLE_SELECTION", "STORYBOARD_REVIEW", "READY_FOR_REVIEW", "CHANGES_REQUESTED"];

export function nextStep(stage: string) {
  const steps: Record<string, { waiting: string; action: string; owner: string }> = {
    IDEA: { waiting: "Creative Director", action: "Develop the concept", owner: "creative" },
    CONCEPT_DEVELOPMENT: { waiting: "Creative Director", action: "Finish the concept", owner: "creative" },
    CONCEPT_REVIEW: { waiting: "Hayden", action: "Approve the concept or ask for changes", owner: "hayden" },
    SCRIPT_DEVELOPMENT: { waiting: "Creative Director", action: "Write the script", owner: "creative" },
    SCRIPT_REVIEW: { waiting: "Hayden", action: "Approve the concept if needed, then lock the script", owner: "hayden" },
    SCRIPT_LOCKED: { waiting: "Hayden", action: "Choose a visual style", owner: "hayden" },
    STYLE_SELECTION: { waiting: "Hayden", action: "Choose the look", owner: "hayden" },
    VISUAL_DIRECTION: { waiting: "Visual Director", action: "Build the world in the selected style", owner: "visual" },
    STORYBOARD_GENERATION: { waiting: "Visual Director", action: "Generate the storyboard sheet", owner: "visual" },
    STORYBOARD_QA: { waiting: "Visual Critic", action: "Check the frames", owner: "visual" },
    STORYBOARD_REVIEW: { waiting: "Hayden", action: "Approve the storyboard or request a new pass", owner: "hayden" },
    VISUAL_LOCKED: { waiting: "Content Factory", action: "Build the production pack", owner: "content" },
    READY_FOR_PRODUCTION: { waiting: "Production", action: "Generate start and end frames when you ask", owner: "hayden" },
    LEGACY: { waiting: "Nobody new", action: "This is an older pack. No approval was invented.", owner: "unassigned" },
  };
  return steps[stage] ?? { waiting: "Hayden", action: "Review the current stage", owner: "hayden" };
}

export function createContentItem(
  db: Database.Database,
  input: {
    idea: string;
    brandText?: string;
    objective?: string;
    audience?: string;
    contentType?: string;
    platform?: string;
    durationSeconds?: number | null;
    referenceNote?: string;
  },
) {
  const named = knownBrand(`${input.brandText ?? ""} ${input.idea}`);
  if (!named) throw new Error("UNKNOWN BRAND. Name a known brand. Nothing was guessed.");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO content_items (
      id, organisation_id, brand, title, objective, audience, rough_idea, content_type, platform, duration_seconds, reference_note, stage, waiting_on, owner, created_at, updated_at
    ) VALUES (?, ?, ?, 'Untitled', ?, ?, ?, ?, ?, ?, ?, 'IDEA', 'Creative Director', 'creative', ?, ?)`,
  ).run(
    id,
    named.id,
    named.name,
    input.objective ?? null,
    input.audience ?? null,
    input.idea.trim(),
    input.contentType ?? null,
    input.platform ?? null,
    input.durationSeconds ?? null,
    input.referenceNote ?? null,
    now,
    now,
  );
  return id;
}

export async function developConcept(db: Database.Database, contentId: string) {
  const item = requireItem(db, contentId);
  setStage(db, contentId, "CONCEPT_DEVELOPMENT");
  const rules = approvedVisualRules(db, item.organisation_id).map((rule) => rule.body).join("\n");
  const drafted = await draft(
    `You are the Creative Director in Hayden OS. You decide the story, not the production. Entertainment first. Do not write a production pack, image prompt, or shot list. For Property Made Simple, do not default to an explainer, presenter, calculator, or talking head. Return JSON only.
{"title":"","objective":"","audience":"","hook":"","coreIdea":"","entertainment":"","story":"","characters":"","format":"","emotionalArc":"","why":"","cta":"","durationSeconds":45,"audioMode":"DIALOGUE"}
audioMode is one of: VOICEOVER, DIALOGUE, VOICEOVER + DIALOGUE, NO SPOKEN AUDIO, MUSIC / SFX LED.`,
    `Brand: ${item.brand}\nIdea: ${item.rough_idea}\nObjective: ${item.objective ?? ""}\nAudience: ${item.audience ?? ""}\nDuration hint: ${item.duration_seconds ?? "about 45 seconds"}\nApproved brand notes:\n${rules || "None stored."}`,
    0.4,
    180000,
  );
  if (!drafted.ok) throw new Error(drafted.message || "The Creative Director did not answer.");
  const parsed = parseModelJson(drafted.text);
  if (!parsed) throw new Error("The concept could not be read. Nothing was stored as approved.");
  const now = new Date().toISOString();
  const conceptId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO creative_concepts (
      id, organisation_id, brand, title, concept, hook, format, objective, audience, script_outline, visual_direction,
      why_it_may_work, cta, production_complexity, variations, next_action, status, created_by, created_at, production_status, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, 'Review the concept. Do not produce it yet.', 'idea', 'creative', ?, 'concept_only', ?)`,
  ).run(
    conceptId,
    item.organisation_id,
    item.brand,
    asText(parsed.title) || "Untitled concept",
    asText(parsed.coreIdea),
    asText(parsed.hook),
    asText(parsed.format),
    asText(parsed.objective) || item.objective,
    asText(parsed.audience) || item.audience,
    asText(parsed.why),
    asText(parsed.cta),
    JSON.stringify({
      entertainment: asText(parsed.entertainment),
      story: asText(parsed.story),
      characters: asText(parsed.characters),
      emotionalArc: asText(parsed.emotionalArc),
      audioMode: asText(parsed.audioMode),
    }),
    now,
    JSON.stringify(parsed),
  );
  db.prepare(`UPDATE content_items SET concept_id = ?, title = ?, stage = 'CONCEPT_REVIEW', waiting_on = 'Hayden', owner = 'hayden', updated_at = ? WHERE id = ?`).run(
    conceptId,
    asText(parsed.title) || item.title,
    now,
    contentId,
  );
  return conceptId;
}

export async function writeScript(db: Database.Database, contentId: string) {
  const item = requireItem(db, contentId);
  if (!item.concept_id) throw new Error("There is no concept to write from.");
  const concept = db.prepare(`SELECT title, concept, hook, notes FROM creative_concepts WHERE id = ?`).get(item.concept_id) as {
    title: string;
    concept: string | null;
    hook: string | null;
    notes: string | null;
  };
  setStage(db, contentId, "SCRIPT_DEVELOPMENT");
  const drafted = await draft(
    `You are the Creative Director writing the script only. Do not write a production pack, image prompt, or camera list. Separate spoken lines from story beats. Shape roughly 45-60 seconds as stimulation, captivation, anticipation, validation, then affection or revelation. Compress that if the piece is shorter. Do not force exact timestamps. Return JSON only.
{"audioMode":"DIALOGUE","spoken":"","voiceover":"","onScreen":"","beats":[{"t":"0-2","name":"Stimulation","line":""}],"qualityNotes":""}`,
    `Brand: ${item.brand}\nTitle: ${concept.title}\nHook: ${concept.hook ?? ""}\nIdea: ${concept.concept ?? ""}\nNotes: ${concept.notes ?? ""}\nTarget seconds: ${item.duration_seconds ?? 45}`,
    0.3,
    180000,
  );
  if (!drafted.ok) throw new Error(drafted.message || "The script was not written.");
  const parsed = parseModelJson(drafted.text);
  if (!parsed) throw new Error("The script could not be read.");
  const spoken = asText(parsed.spoken);
  const voiceover = asText(parsed.voiceover);
  const beats = Array.isArray(parsed.beats) ? parsed.beats : [];
  const words = `${spoken} ${voiceover}`.trim().split(/\s+/).filter(Boolean).length;
  const estimated = Math.max(1, Math.round((words / 150) * 60));
  const target = item.duration_seconds;
  const flags = [asText(parsed.qualityNotes)];
  if ((spoken || voiceover).length < 40) flags.push("The spoken script is very short.");
  if (target && Math.abs(estimated - target) > 20) flags.push(`Estimated speech is about ${estimated}s against a ${target}s target.`);
  const version = (db.prepare(`SELECT COALESCE(MAX(version), 0) AS n FROM content_scripts WHERE content_id = ?`).get(contentId) as { n: number }).n + 1;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const structure = target && target <= 20 ? ["Stimulation", "Escalation", "Payoff"] : target && target <= 35 ? ["Stimulation", "Captivation", "Escalation", "Payoff"] : ["Stimulation", "Captivation", "Anticipation", "Validation", "Affection / revelation"];
  db.prepare(
    `INSERT INTO content_scripts (
      id, content_id, version, audio_mode, spoken, voiceover, on_screen, beats_json, structure_json, estimated_seconds, quality_notes, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
  ).run(id, contentId, version, asText(parsed.audioMode) || "DIALOGUE", spoken, voiceover, asText(parsed.onScreen), JSON.stringify(beats), JSON.stringify(structure), estimated, flags.filter(Boolean).join(" "), now);
  db.prepare(`UPDATE content_items SET stage = 'SCRIPT_REVIEW', waiting_on = 'Hayden', owner = 'hayden', updated_at = ? WHERE id = ?`).run(now, contentId);
  return id;
}

export function approveConcept(db: Database.Database, contentId: string) {
  const item = requireItem(db, contentId);
  if (!item.concept_id) throw new Error("There is no concept to approve.");
  const now = new Date().toISOString();
  db.prepare(`UPDATE creative_concepts SET status = 'approved', approved_at = ?, approved_by = 'hayden' WHERE id = ?`).run(now, item.concept_id);
  if (item.stage === "CONCEPT_REVIEW") setStage(db, contentId, "SCRIPT_DEVELOPMENT");
}

export function lockScript(db: Database.Database, contentId: string) {
  const item = requireItem(db, contentId);
  const concept = item.concept_id ? (db.prepare(`SELECT status FROM creative_concepts WHERE id = ?`).get(item.concept_id) as { status: string } | undefined) : undefined;
  if (concept?.status !== "approved") throw new Error("Approve the concept before locking the script.");
  const script = latestScript(db, contentId);
  if (!script) throw new Error("There is no script to lock.");
  if (db.prepare(`SELECT id FROM script_locks WHERE content_id = ?`).get(contentId)) return;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO script_locks (id, content_id, script_id, locked_by, created_at) VALUES (?, ?, ?, 'hayden', ?)`).run(crypto.randomUUID(), contentId, script.id, now);
  db.prepare(`UPDATE content_scripts SET status = 'locked' WHERE id = ?`).run(script.id);
  if (item.concept_id) db.prepare(`UPDATE creative_concepts SET script_outline = ? WHERE id = ?`).run(script.spoken || script.voiceover, item.concept_id);
  setStage(db, contentId, "STYLE_SELECTION");
}

export function changeSpoken(db: Database.Database, contentId: string, next: string) {
  if (db.prepare(`SELECT id FROM script_locks WHERE content_id = ?`).get(contentId)) {
    db.prepare(`INSERT INTO creative_change_requests (id, content_id, kind, detail, status, created_at) VALUES (?, ?, 'SCRIPT', ?, 'open', ?)`).run(
      crypto.randomUUID(),
      contentId,
      "A downstream change tried to rewrite locked spoken content. It was not applied.",
      new Date().toISOString(),
    );
    throw new Error("The script is locked. A script change request was raised. The spoken lines were not changed.");
  }
  const script = latestScript(db, contentId);
  if (!script) throw new Error("There is no script to edit.");
  db.prepare(`UPDATE content_scripts SET spoken = ? WHERE id = ?`).run(next, script.id);
}

export function selectStyle(db: Database.Database, contentId: string, styleId: string) {
  requireItem(db, contentId);
  if (!db.prepare(`SELECT id FROM script_locks WHERE content_id = ?`).get(contentId)) throw new Error("Lock the script before choosing a style.");
  const style = db.prepare(`SELECT id, status FROM style_templates WHERE id = ?`).get(styleId) as { id: string; status: string } | undefined;
  if (!style || style.status !== "approved") throw new Error("That style is not an approved template.");
  const version = (db.prepare(`SELECT COALESCE(MAX(version), 0) AS n FROM style_locks WHERE content_id = ?`).get(contentId) as { n: number }).n + 1;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO style_locks (id, content_id, style_id, version, selected_by, created_at) VALUES (?, ?, ?, ?, 'hayden', ?)`).run(crypto.randomUUID(), contentId, styleId, version, now);
  setStage(db, contentId, "VISUAL_DIRECTION");
  return version;
}

export function newStoryboardPass(db: Database.Database, contentId: string, kind: string) {
  const script = db.prepare(`SELECT script_id FROM script_locks WHERE content_id = ?`).get(contentId) as { script_id: string } | undefined;
  const style = db.prepare(`SELECT id FROM style_locks WHERE content_id = ? ORDER BY version DESC LIMIT 1`).get(contentId) as { id: string } | undefined;
  if (!script || !style) throw new Error("A new pass needs a locked script and a selected style.");
  if (kind === "CHANGE STYLE") setStage(db, contentId, "STYLE_SELECTION");
  const passNumber = (db.prepare(`SELECT COALESCE(MAX(pass_number), 0) AS n FROM storyboard_passes WHERE content_id = ?`).get(contentId) as { n: number }).n + 1;
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO storyboard_passes (id, content_id, pass_number, kind, style_lock_id, script_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`).run(
    id,
    contentId,
    passNumber,
    kind,
    style.id,
    script.script_id,
    new Date().toISOString(),
  );
  return id;
}

export function approveVisuals(db: Database.Database, contentId: string) {
  const script = db.prepare(`SELECT script_id FROM script_locks WHERE content_id = ?`).get(contentId) as { script_id: string } | undefined;
  const style = db.prepare(`SELECT id FROM style_locks WHERE content_id = ? ORDER BY version DESC LIMIT 1`).get(contentId) as { id: string } | undefined;
  const pass = db.prepare(`SELECT id FROM storyboard_passes WHERE content_id = ? ORDER BY pass_number DESC LIMIT 1`).get(contentId) as { id: string } | undefined;
  const frames = db.prepare(`SELECT COUNT(*) AS n FROM generated_assets WHERE concept_id = (SELECT concept_id FROM content_items WHERE id = ?) AND asset_role = 'STORYBOARD_FRAME' AND file_size > 0`).get(contentId) as { n: number };
  if (!script || !style || !pass || frames.n < 1) throw new Error("Approve visuals only after a storyboard pass exists.");
  if (db.prepare(`SELECT id FROM visual_locks WHERE content_id = ?`).get(contentId)) return;
  db.prepare(`INSERT INTO visual_locks (id, content_id, pass_id, script_id, style_lock_id, locked_by, created_at) VALUES (?, ?, ?, ?, ?, 'hayden', ?)`).run(
    crypto.randomUUID(),
    contentId,
    pass.id,
    script.script_id,
    style.id,
    new Date().toISOString(),
  );
  setStage(db, contentId, "VISUAL_LOCKED");
}

export function productionBlock(db: Database.Database, conceptId: string | null) {
  if (!conceptId) return null;
  const item = db.prepare(`SELECT id FROM content_items WHERE concept_id = ? AND stage != 'LEGACY'`).get(conceptId) as { id: string } | undefined;
  if (!item) return null;
  if (db.prepare(`SELECT id FROM visual_locks WHERE content_id = ?`).get(item.id)) return null;
  return "The production pack waits until the script and the storyboard are locked. No pack was written.";
}

export function styleBlock(db: Database.Database, conceptId: string | null) {
  if (!conceptId) return null;
  const item = db.prepare(`SELECT id FROM content_items WHERE concept_id = ? AND stage != 'LEGACY'`).get(conceptId) as { id: string } | undefined;
  if (!item) return null;
  if (db.prepare(`SELECT id FROM style_locks WHERE content_id = ?`).get(item.id)) return null;
  return "Choose a visual style before visual direction or a storyboard.";
}

export function currentStyleRules(db: Database.Database, conceptId: string | null) {
  if (!conceptId) return "";
  const row = db.prepare(`SELECT l.style_id FROM style_locks l JOIN content_items c ON c.id = l.content_id WHERE c.concept_id = ? ORDER BY l.version DESC LIMIT 1`).get(conceptId) as { style_id: string } | undefined;
  return row ? styleCriticRules(row.style_id) : "";
}

export function creativeQueue(db: Database.Database) {
  return db.prepare(`SELECT id, brand, title, stage, waiting_on, owner FROM content_items WHERE stage IN (${WAITING.map(() => "?").join(",")}) ORDER BY updated_at DESC`).all(...WAITING) as Array<{
    id: string;
    brand: string | null;
    title: string | null;
    stage: string;
    waiting_on: string | null;
    owner: string | null;
  }>;
}

export function gpuHandoff(db: Database.Database, contentId: string) {
  const item = requireItem(db, contentId);
  const script = latestScript(db, contentId);
  const style = db.prepare(`SELECT style_id FROM style_locks WHERE content_id = ? ORDER BY version DESC LIMIT 1`).get(contentId) as { style_id: string } | undefined;
  const template = style ? styleById(style.style_id) : undefined;
  return {
    contentId,
    title: item.title,
    brand: item.brand,
    script: script?.spoken || script?.voiceover || null,
    audioMode: script?.audio_mode ?? null,
    style: template?.name ?? null,
    styleMedium: template?.visualMedium ?? null,
    note: "The GPU executes this handoff. It does not choose the story or the style.",
  };
}

function setStage(db: Database.Database, id: string, stage: string) {
  const step = nextStep(stage);
  db.prepare(`UPDATE content_items SET stage = ?, waiting_on = ?, owner = ?, updated_at = ? WHERE id = ?`).run(stage, step.waiting, step.owner, new Date().toISOString(), id);
}

function requireItem(db: Database.Database, id: string) {
  const item = db.prepare(`SELECT * FROM content_items WHERE id = ?`).get(id) as
    | {
        id: string;
        organisation_id: string | null;
        brand: string | null;
        title: string | null;
        objective: string | null;
        audience: string | null;
        rough_idea: string | null;
        duration_seconds: number | null;
        concept_id: string | null;
        stage: string;
      }
    | undefined;
  if (!item) throw new Error("That content item is not stored.");
  return item;
}

function latestScript(db: Database.Database, contentId: string) {
  return db.prepare(`SELECT id, spoken, voiceover, audio_mode FROM content_scripts WHERE content_id = ? ORDER BY version DESC LIMIT 1`).get(contentId) as
    | { id: string; spoken: string | null; voiceover: string | null; audio_mode: string | null }
    | undefined;
}
