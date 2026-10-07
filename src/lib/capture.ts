export const CAPTURE_KINDS = ["task", "idea", "decision", "project", "note"] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

/** Lightweight rules. A model can replace this later. Captures stay out of Hayden's morning list. */
export function classifyCapture(text: string): CaptureKind {
  const value = text.trim().toLowerCase();
  if (/^idea\b|\bidea:/.test(value)) return "idea";
  if (/^note\b|^remember\b|\bneed to talk\b|\bremind me\b/.test(value)) return "note";
  if (/\b(approve|decision|decide|choose between|kill or continue|kill\/continue)\b/.test(value)) return "decision";
  if (/^project\b|\bnew project\b/.test(value)) return "project";
  return "task";
}

export function mentionedPersonId(text: string, people: Array<{ id: string; name: string }>) {
  const value = text.toLowerCase();
  const match = people.find((person) => {
    const first = person.name.toLowerCase().split(" ")[0] ?? "";
    return first.length > 2 && new RegExp(`\\b${first}\\b`, "i").test(value);
  });
  return match?.id ?? null;
}
