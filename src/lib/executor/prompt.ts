import type { PackRow, SceneRow } from "@/lib/factory/store";
import { SUPPORTED_ASPECT_RATIOS } from "@/lib/executor/providers";
import type { AssetRole } from "@/lib/executor/types";

export function resolveAspect(value: string | null): { ratio: string; note: string | null } | { error: string } {
  const raw = (value ?? "").trim().replace(/\s+/g, "");
  if (!raw) return { ratio: "9:16", note: "The pack had no aspect ratio. Used 9:16." };
  if (SUPPORTED_ASPECT_RATIOS.has(raw)) return { ratio: raw, note: null };
  return { error: `Unsupported aspect ratio: ${value}` };
}

export function shouldReferencePreviousEnd(scene: SceneRow, previous: SceneRow | null) {
  if (!previous) return false;
  const text = `${scene.continuity_from ?? ""}`.toLowerCase();
  if (!text.trim()) return false;
  if (/do not|don't|new location|unrelated|hard cut|fresh start|no continuity/.test(text)) return false;
  return /same|continue|match|carry|previous|connect|end frame|from the|leads into/.test(text);
}

export function buildImagePrompt(input: {
  pack: PackRow;
  scene: SceneRow;
  role: AssetRole;
  rules: string[];
  feedback?: string | null;
}) {
  const scene = input.scene;
  const moment =
    input.role === "START_FRAME"
      ? scene.start_frame
      : input.role === "END_FRAME"
        ? scene.end_frame
        : scene.visual || scene.action || scene.objective;
  const lines = [
    input.role === "STORYBOARD_FRAME"
      ? "Single storyboard frame for a short video. Show one clear moment. It is a visual direction frame, not a finished advertisement and not a diagram."
      : input.role === "START_FRAME"
        ? "Opening still of this scene. Show the start state only."
        : "Closing still of this scene. Show the end state only.",
    input.pack.brand ? `Brand world: ${input.pack.brand}.` : "",
    input.pack.production_type ? `Production type: ${input.pack.production_type}.` : "",
    input.pack.global_visual_direction ? `Visual direction: ${input.pack.global_visual_direction}` : "",
    input.pack.character_bible ? `Characters, keep the same people if they recur: ${input.pack.character_bible}` : "",
    input.pack.location_bible ? `Locations: ${input.pack.location_bible}` : "",
    scene.characters ? `In this scene: ${scene.characters}` : "",
    scene.location ? `Location: ${scene.location}` : "",
    scene.action ? `Action: ${scene.action}` : "",
    scene.camera ? `Camera: ${scene.camera}` : "",
    scene.visual ? `Lighting, time of day, and look: ${scene.visual}` : "",
    moment ? `This frame: ${moment}` : "",
    input.pack.continuity_rules ? `Continuity rules: ${input.pack.continuity_rules}` : "",
    scene.continuity_from ? `Continuity from the previous scene: ${scene.continuity_from}` : "",
    "If the scene is in Australia, use Australian rooms and objects. Do not force a photographic look.",
    "No logo. No speech bubble. No readable phone, document, payslip, calculator, or statement aimed at camera.",
    "Negative constraints:",
    ...input.rules.map((rule) => `- ${rule}`),
    input.feedback ? `Change requested by Hayden: ${input.feedback}. Keep the scene the same except for that note.` : "",
  ];
  return lines.filter(Boolean).join("\n").slice(0, 6000);
}

export function sceneHasPicture(scene: SceneRow) {
  return [scene.visual, scene.action, scene.objective, scene.start_frame, scene.end_frame, scene.characters, scene.location].some((value) => value && value.trim());
}
