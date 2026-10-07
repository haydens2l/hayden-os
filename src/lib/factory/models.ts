import type Database from "better-sqlite3";
import { CAPABILITY_FIELDS, type CapabilityField } from "@/lib/factory/types";

export type ModelProfile = {
  id: string;
  slug: string;
  name: string;
  allowed_durations: string;
  prompt_style: string;
  start_end_frames: string;
  audio_support: string;
  dialogue_support: string;
  aspect_ratios: string;
  known_limitations: string;
  notes: string | null;
};

export function listModelProfiles(db: Database.Database) {
  return db.prepare(`SELECT * FROM production_model_profiles ORDER BY name`).all() as ModelProfile[];
}

export function modelCapability(db: Database.Database, slugOrName: string, field: CapabilityField) {
  const profile = db
    .prepare(`SELECT * FROM production_model_profiles WHERE slug = ? OR lower(name) = lower(?)`)
    .get(slugOrName, slugOrName) as ModelProfile | undefined;
  if (!profile || !CAPABILITY_FIELDS.includes(field)) return "UNKNOWN";
  const value = profile[field]?.trim();
  if (!value || value.toLowerCase() === "unknown") return "UNKNOWN";
  return value;
}

export function setModelCapability(db: Database.Database, profileId: string, field: CapabilityField, value: string) {
  const next = value.trim();
  if (!next) throw new Error("A capability needs a verified value. Leave it unknown rather than guessing.");
  const column: Record<CapabilityField, string> = {
    allowed_durations: "allowed_durations",
    prompt_style: "prompt_style",
    start_end_frames: "start_end_frames",
    audio_support: "audio_support",
    dialogue_support: "dialogue_support",
    aspect_ratios: "aspect_ratios",
    known_limitations: "known_limitations",
  };
  db.prepare(`UPDATE production_model_profiles SET ${column[field]} = ? WHERE id = ?`).run(next, profileId);
}
