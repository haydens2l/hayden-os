import type Database from "better-sqlite3";
import { listScenes } from "@/lib/factory/store";

export type BriefSection = { label: string; body: string };

export function executionBrief(db: Database.Database, packId: string): BriefSection[] {
  const pack = db
    .prepare(
      `SELECT p.*, c.title AS concept_title, c.objective AS concept_objective, c.hook
       FROM production_packs p
       LEFT JOIN creative_concepts c ON c.id = p.creative_concept_id
       WHERE p.id = ?`,
    )
    .get(packId) as Record<string, string | number | null> | undefined;
  if (!pack) return [];
  const scenes = listScenes(db, packId);
  const sceneText = scenes
    .map((scene) => {
      const bits = [
        `Scene ${scene.scene_number}`,
        scene.objective,
        scene.action,
        scene.visual,
      ].filter(Boolean);
      return bits.join(" — ");
    })
    .join("\n");
  const prompts = scenes
    .map((scene) => (scene.video_prompt ? `Scene ${scene.scene_number}: ${scene.video_prompt}` : null))
    .filter(Boolean)
    .join("\n");
  const frames = scenes
    .map((scene) => `Scene ${scene.scene_number}: start — ${scene.start_frame || "Not written"}. End — ${scene.end_frame || "Not written"}.`)
    .join("\n");
  const continuity = [pack.continuity_rules, ...scenes.map((scene) => scene.continuity_from || scene.continuity_into)].filter(Boolean).join("\n");
  return [
    { label: "What you are making", body: text(pack.concept_title) || `${text(pack.brand)} ${text(pack.production_type)}` },
    { label: "Why", body: text(pack.concept_objective) || text(pack.hook) || "Make the approved piece. The strategy stays in Business Brain." },
    { label: "Brand", body: text(pack.brand) || "Not stored" },
    { label: "Format", body: [text(pack.production_type), text(pack.aspect_ratio), text(pack.target_duration)].filter(Boolean).join(" · ") || "Not stored" },
    { label: "Reference", body: text(pack.character_bible) || text(pack.location_bible) || text(pack.global_visual_direction) || "No reference is stored on this pack." },
    { label: "Script", body: text(pack.script) || "No script is stored." },
    { label: "Scenes", body: sceneText || "No scenes are stored." },
    { label: "Start frames", body: frames || "No frame descriptions are stored." },
    { label: "End frames", body: "End frame notes are in the start-frame section for each scene." },
    { label: "Prompts", body: prompts || "No scene prompts are stored." },
    { label: "Voice / audio", body: [text(pack.voice_direction), text(pack.sound_direction), text(pack.music_direction)].filter(Boolean).join("\n") || "No voice or audio note is stored." },
    { label: "On-screen text", body: text(pack.on_screen_text) || scenes.map((scene) => scene.on_screen_text).filter(Boolean).join("\n") || "None stored." },
    { label: "Continuity", body: continuity || "No continuity note is stored." },
    { label: "Production notes", body: text(pack.editing_notes) || scenes.map((scene) => scene.production_notes).filter(Boolean).join("\n") || "None stored." },
    { label: "Deliverable", body: "The finished piece for this pack: a file, a link, or the asset you made. Not a strategy note." },
    { label: "What done looks like", body: "Hayden can review a version and either approve it or send changes. Approving a concept, a storyboard, or a frame is not the same as finishing this." },
  ];
}

export function taskBrief(db: Database.Database, taskId: string): BriefSection[] {
  const task = db
    .prepare(
      `SELECT t.title, t.description, t.recommended_action, t.why_it_matters, o.name AS org_name
       FROM tasks t LEFT JOIN organisations o ON o.id = t.organisation_id WHERE t.id = ?`,
    )
    .get(taskId) as
    | { title: string; description: string | null; recommended_action: string | null; why_it_matters: string | null; org_name: string | null }
    | undefined;
  if (!task) return [];
  return [
    { label: "What you are doing", body: task.title },
    { label: "Why", body: task.why_it_matters || "Do the stored task. Unrelated strategy is not included." },
    { label: "Business", body: task.org_name || "Not stored" },
    { label: "Detail", body: task.description || "No extra detail is stored." },
    { label: "What done looks like", body: task.recommended_action || "The task is done and Hayden is not asked to manage the steps." },
  ];
}

function text(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}
