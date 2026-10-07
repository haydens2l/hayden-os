export const PRODUCTION_TYPES = [
  ["ai_video", "AI video"],
  ["ugc", "UGC"],
  ["motion_graphics", "Motion graphics"],
  ["claymation", "Claymation"],
  ["photorealistic_ai_video", "Photorealistic AI video"],
  ["image_ad", "Image ad"],
  ["carousel", "Carousel"],
  ["street_interview", "Street interview"],
  ["hybrid", "Hybrid"],
] as const;

export type ProductionType = (typeof PRODUCTION_TYPES)[number][0];

export const FRAME_TYPES = new Set<ProductionType>(["ai_video", "photorealistic_ai_video", "claymation", "hybrid"]);

export const PACK_STATUSES = [
  "draft",
  "needs_review",
  "approved",
  "assigned",
  "in_production",
  "blocked",
  "ready_for_review",
  "complete",
  "archived",
] as const;

export type PackStatus = (typeof PACK_STATUSES)[number];

export const FEEDBACK_KINDS = [
  ["prompt_failed", "Prompt failed"],
  ["continuity_issue", "Continuity issue"],
  ["voice_issue", "Voice issue"],
  ["model_issue", "Model issue"],
  ["script_too_long", "Script too long"],
  ["visual_mismatch", "Visual mismatch"],
  ["other", "Other"],
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number][0];

export const CAPABILITY_FIELDS = [
  "allowed_durations",
  "prompt_style",
  "start_end_frames",
  "audio_support",
  "dialogue_support",
  "aspect_ratios",
  "known_limitations",
] as const;

export type CapabilityField = (typeof CAPABILITY_FIELDS)[number];

export function productionTypeLabel(value: string) {
  return PRODUCTION_TYPES.find(([id]) => id === value)?.[1] ?? value;
}

export function statusLabel(value: string) {
  return value.replaceAll("_", " ").toUpperCase();
}
