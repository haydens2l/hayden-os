import type Database from "better-sqlite3";
import type { CommandAnswer } from "@/lib/command/answer";
import { storyboardEstimate } from "@/lib/visual/generate";
import { getIntent } from "@/lib/visual/intent";

export function isVisualRead(query: string) {
  return /why did scene|what the critic|which frames are weak|show me the visual world|look like property made simple|look generic|visual joke|prompt used for scene/i.test(query);
}

export function answerVisual(db: Database.Database, query: string): CommandAnswer {
  const concept = db.prepare(`SELECT id, title, brand FROM creative_concepts WHERE status = 'approved' ORDER BY approved_at DESC LIMIT 1`).get() as
    | { id: string; title: string; brand: string | null }
    | undefined;
  if (!concept) return { heading: "Visual Director", summary: "No approved concept is stored.", items: [] };
  const lock = getIntent(db, concept.id);
  const direction = db.prepare(`SELECT thesis, humour_test FROM visual_directions WHERE concept_id = ? ORDER BY created_at DESC LIMIT 1`).get(concept.id) as
    | { thesis: string | null; humour_test: string | null }
    | undefined;
  const sceneNumber = Number(query.match(/scene\s+(\d+)/i)?.[1] ?? "");
  if (/why did scene|what the critic|prompt used/i.test(query) && sceneNumber) {
    const critique = db
      .prepare(
        `SELECT c.summary, c.scores, a.prompt, a.generation_status, a.error_message
         FROM visual_critiques c
         JOIN generated_assets a ON a.id = c.asset_id
         JOIN production_scenes s ON s.id = a.scene_id
         WHERE s.scene_number = ? AND a.concept_id = ?
         ORDER BY c.created_at DESC LIMIT 1`,
      )
      .get(sceneNumber, concept.id) as { summary: string | null; scores: string; prompt: string | null; generation_status: string; error_message: string | null } | undefined;
    if (!critique) return { heading: concept.title, summary: `Scene ${sceneNumber} has no visual critique yet.`, items: [] };
    return {
      heading: `Scene ${sceneNumber}`,
      summary: critique.error_message || critique.summary || critique.generation_status,
      items: [
        { title: "Critic", detail: critique.summary || "No summary.", source: "visual_critiques" },
        { title: "Prompt", detail: (critique.prompt ?? "").slice(0, 700), source: "generated_assets" },
      ],
    };
  }
  const weak = db.prepare(`SELECT scene_number, visual_joke, mute_test FROM shot_plans WHERE concept_id = ? AND mute_test = 'WEAK'`).all(concept.id) as Array<{
    scene_number: number;
    visual_joke: string | null;
    mute_test: string;
  }>;
  const estimate = storyboardEstimate(db, concept.id);
  return {
    heading: concept.title,
    summary: direction?.thesis || "Visual direction has not been written yet.",
    items: [
      { title: "Brand", detail: lock?.brand ?? concept.brand ?? "UNKNOWN BRAND", source: "creative_intent_locks" },
      { title: "Medium", detail: lock?.visual_medium ?? "Not locked", source: "creative_intent_locks" },
      { title: "Humour", detail: direction?.humour_test || lock?.humour_mechanism || "Not stored", source: "visual_directions" },
      {
        title: "Storyboard cost",
        detail: `${estimate.frames} frames, ${estimate.heroes} hero. First pass ${estimate.firstPass}. Maximum ${estimate.maximumGenerations}. Estimate ${estimate.estimateUsd == null ? "unknown" : `$${estimate.estimateUsd.toFixed(2)}`}. ${estimate.basis}`,
        source: "visual_settings",
      },
      ...weak.map((shot) => ({ title: `Scene ${shot.scene_number} is weak muted`, detail: shot.visual_joke || "No visual joke stored.", source: "shot_plans" })),
    ],
  };
}
