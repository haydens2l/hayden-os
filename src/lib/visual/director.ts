import type Database from "better-sqlite3";
import { draft, parseModelJson, asText } from "@/lib/team/draft";
import { approvedVisualRules } from "@/lib/visual/brain";
import { getIntent, proposeDeviation } from "@/lib/visual/intent";
import { styleBlock } from "@/lib/content/workflow";
import { styleById } from "@/lib/content/styles";

type ConceptSlice = {
  id: string;
  title: string;
  brand: string | null;
  hook: string | null;
  concept: string | null;
  format: string | null;
  script_outline: string | null;
  visual_direction: string | null;
  why_it_may_work: string | null;
  audience: string | null;
  organisation_id: string | null;
};

export async function runVisualDirector(db: Database.Database, conceptId: string, jobId: string | null) {
  const concept = db.prepare(`SELECT * FROM creative_concepts WHERE id = ?`).get(conceptId) as ConceptSlice | undefined;
  if (!concept) throw new Error("That concept is not stored.");
  if (concept && db.prepare(`SELECT status FROM creative_concepts WHERE id = ?`).get(conceptId) && (db.prepare(`SELECT status FROM creative_concepts WHERE id = ?`).get(conceptId) as { status: string }).status !== "approved") {
    throw new Error("Approve the concept before visual direction.");
  }
  const lock = getIntent(db, conceptId);
  if (!lock) throw new Error("The creative intent is not locked.");
  if (lock.brand === "UNKNOWN BRAND") throw new Error("UNKNOWN BRAND. Name the brand before visual direction. Nothing was guessed.");
  const held = styleBlock(db, conceptId);
  if (held) throw new Error(held);
  const selected = db.prepare(`SELECT l.style_id FROM style_locks l JOIN content_items c ON c.id = l.content_id WHERE c.concept_id = ? ORDER BY l.version DESC LIMIT 1`).get(conceptId) as { style_id: string } | undefined;
  const chosen = selected ? styleById(selected.style_id) : undefined;
  const rules = approvedVisualRules(db, lock.organisation_id);
  const references = db
    .prepare(`SELECT kind, subject, liked, reuse FROM visual_anchors WHERE organisation_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 4`)
    .all(lock.organisation_id) as Array<{ kind: string; subject: string | null; liked: string | null; reuse: string | null }>;
  const drafted = await draft(
    `You are the Visual Director inside Hayden OS. You execute the selected style for this story. You do not rewrite the concept. You do not replace the selected style. If the style cannot carry the story, say so in proposedDeviation and still plan inside the style. Return JSON only.
{"thesis":"","proposedDeviation":"","world":"","characters":"","shotLanguage":"","storyArc":"","humour":"","shots":[{"sceneNumber":1,"role":"hero","storyPurpose":"","visualJoke":"","subject":"","action":"","composition":"","foreground":"","midground":"","background":"","cameraPosition":"","cameraHeight":"","shotSize":"","lensFeeling":"","lighting":"","colour":"","environment":"","props":"","expression":"","readable":"","continuity":"","mustNot":"","muteTest":"STRONG"}]}
role is hero, supporting, or transition. muteTest is STRONG, ADEQUATE, or WEAK. Keep each shot to short lines. Plan the scenes implied by the script. Do not dump business context.`,
    `Locked brand: ${lock.brand}
Selected style: ${chosen ? `${chosen.name}. ${chosen.recipe} Negative: ${chosen.negative}` : "No master style selected. Legacy concept."}
Locked format: ${lock.format ?? ""}
Locked medium: ${lock.visual_medium}
Locked device: ${lock.core_device}
Required: ${lock.required_motif}
Forbidden: ${lock.forbidden_changes}
Humour: ${lock.humour_mechanism}

Title: ${concept.title}
Hook: ${concept.hook ?? ""}
Idea: ${concept.concept ?? ""}
Script: ${concept.script_outline ?? ""}
Creative visual note: ${concept.visual_direction ?? ""}

Brand visual rules:
${rules.map((rule) => `- ${rule.title}: ${rule.body}`).join("\n") || "None stored."}

Approved visual references, use only if relevant:
${references.map((item) => `- ${item.kind}: ${item.subject ?? ""} ${item.liked ?? ""} Reuse: ${item.reuse ?? ""}`).join("\n") || "None."}`,
    0.3,
    180000,
  );
  if (!drafted.ok) throw new Error(drafted.message || "The Visual Director did not answer.");
  const parsed = parseModelJson(drafted.text);
  if (!parsed) throw new Error("The Visual Director did not return a visual plan.");
  if (asText(parsed.proposedDeviation)) proposeDeviation(db, conceptId, "visual", asText(parsed.proposedDeviation));
  const now = new Date().toISOString();
  const sketch = /sketch|illustrat/i.test(lock.visual_medium ?? "");
  db.prepare(`DELETE FROM visual_style_profiles WHERE concept_id = ?`).run(conceptId);
  db.prepare(
    `INSERT INTO visual_style_profiles (
      id, concept_id, visual_medium, style_name, style_description, reference_family, realism_level, stylisation_level,
      texture, colour_philosophy, lighting_philosophy, contrast, camera_language, lens_language, composition_language,
      character_design, environment_design, production_design, motion_language, humour_language, visual_metaphors,
      graphic_elements, typography_usage, continuity_strategy, reference_strategy, negative_style_constraints, locked, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    crypto.randomUUID(),
    conceptId,
    lock.visual_medium,
    sketch ? "Tactile editorial sketch" : "Approved medium",
    sketch
      ? "Stylised cinematic illustration with handmade paper texture. Not a photograph."
      : `Stay inside ${lock.visual_medium}.`,
    sketch ? "Illustrated editorial" : lock.visual_medium,
    sketch ? "Low" : "As the medium requires",
    sketch ? "High" : "As the medium requires",
    sketch ? "Visible paper and handmade imperfection" : "Texture that belongs to the locked medium",
    sketch ? "Limited ink and wash. Blue night against warm daylight. No glossy brand colours." : "Colour serves the locked medium.",
    sketch ? "Exaggerated cinematic pools, not photographic realism." : "Light that belongs to the locked medium.",
    "Readable shapes first.",
    "Simple deliberate framing. Silhouettes must read at a glance.",
    "A normal human viewpoint. No dramatic product lens.",
    lock.required_motif,
    "Same two people when they recur. Specify only details that keep them recognisable.",
    "Ordinary Australian rooms when the concept is at home. No showroom.",
    "Designed frames. Props belong in the room.",
    "Left side barely moves. Right side advances in time.",
    asText(parsed.humour) || lock.humour_mechanism,
    lock.core_device,
    "Headline words only as rough lettering on a paper plane or a simple end line. No logo.",
    "Minimal. No brand lockup.",
    "Use an approved anchor, then the previous frame only when the shot says the same place continues.",
    "One relevant reference image per generation. Do not send the whole library.",
    sketch
      ? "No generic stock photography. No glossy bank-ad look. No plastic AI skin. No photoreal live-action."
      : "No generic stock advertising. No logo. No speech bubbles.",
    now,
  );
  db.prepare(`DELETE FROM visual_directions WHERE concept_id = ?`).run(conceptId);
  db.prepare(
    `INSERT INTO visual_directions (
      id, concept_id, job_id, thesis, world_bible, character_bible, shot_language, visual_story_arc, humour_test, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
  ).run(
    crypto.randomUUID(),
    conceptId,
    jobId,
    asText(parsed.thesis),
    asText(parsed.world),
    asText(parsed.characters),
    asText(parsed.shotLanguage),
    asText(parsed.storyArc),
    asText(parsed.humour),
    now,
  );
  const shots = Array.isArray(parsed.shots) ? parsed.shots : [];
  db.prepare(`DELETE FROM shot_plans WHERE concept_id = ?`).run(conceptId);
  const insert = db.prepare(
    `INSERT INTO shot_plans (
      id, concept_id, scene_number, role, story_purpose, visual_joke, subject, action, composition, foreground, midground, background,
      camera_position, camera_height, shot_size, lens_feeling, lighting, colour, environment, props, expression, readable,
      continuity_dependency, references_required, must_not_appear, mute_test, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  shots.forEach((item, index) => {
    const shot = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const number = Number(shot.sceneNumber) || index + 1;
    const mute = asText(shot.muteTest, "ADEQUATE").toUpperCase();
    let composition = asText(shot.composition);
    if (/split/i.test(lock.required_motif ?? "") && !/split/i.test(composition)) composition = `Locked split screen. ${composition}`.trim();
    insert.run(
      crypto.randomUUID(),
      conceptId,
      number,
      normalRole(asText(shot.role, number === 1 ? "hero" : "supporting")),
      asText(shot.storyPurpose),
      asText(shot.visualJoke),
      asText(shot.subject),
      asText(shot.action),
      composition,
      asText(shot.foreground),
      asText(shot.midground),
      asText(shot.background),
      asText(shot.cameraPosition),
      asText(shot.cameraHeight),
      asText(shot.shotSize),
      asText(shot.lensFeeling),
      asText(shot.lighting),
      asText(shot.colour),
      asText(shot.environment),
      asText(shot.props),
      asText(shot.expression),
      asText(shot.readable),
      asText(shot.continuity),
      "style anchor, and the character anchor when a person recurs",
      asText(shot.mustNot),
      mute === "STRONG" || mute === "WEAK" ? mute : "ADEQUATE",
      now,
    );
  });
  const weak = db.prepare(`SELECT scene_number FROM shot_plans WHERE concept_id = ? AND mute_test = 'WEAK'`).all(conceptId) as Array<{ scene_number: number }>;
  return {
    summary: `Visual direction is ready for ${concept.title}. Medium stays ${lock.visual_medium}. ${weak.length ? `Scenes ${weak.map((row) => row.scene_number).join(", ")} are weak with the sound off.` : "No scene was marked weak with the sound off."}`,
    findings: asText(parsed.thesis),
    recommendations: weak.length ? "Strengthen the weak frames in the shot plan before generation." : "Generate the storyboard from this shot plan.",
    confidence: rules.length ? "medium" : "low",
    evidence: lock.brand,
    model: drafted.model,
    inputTokens: drafted.inputTokens,
    outputTokens: drafted.outputTokens,
    requiresHayden: Boolean(asText(parsed.proposedDeviation)) || weak.length > 0,
  };
}

function normalRole(value: string) {
  const text = value.toLowerCase();
  if (text.includes("hero")) return "hero";
  if (text.includes("transition")) return "transition";
  return "supporting";
}
