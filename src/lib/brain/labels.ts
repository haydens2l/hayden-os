export const CONTEXT_TYPES = ["FACT", "STRATEGY", "PREFERENCE", "ASSUMPTION", "HYPOTHESIS", "DECISION", "HISTORICAL"] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];

export const CONTEXT_LABEL: Record<ContextType, string> = {
  FACT: "Known fact",
  STRATEGY: "Founder strategy",
  PREFERENCE: "Preference",
  ASSUMPTION: "Assumption",
  HYPOTHESIS: "Hypothesis",
  DECISION: "Decision",
  HISTORICAL: "Historical information",
};

export function contextLabel(value: string | null | undefined) {
  if (!value) return "Unlabelled";
  return CONTEXT_LABEL[value as ContextType] ?? value;
}

export function humanToken(value: string | null | undefined) {
  if (!value) return "Not set";
  return value
    .split("/")
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    )
    .join(" / ");
}

export function isCurrentContext(item: { superseded_by_id?: string | null; context_type?: string | null }) {
  return !item.superseded_by_id && item.context_type !== "HISTORICAL";
}
