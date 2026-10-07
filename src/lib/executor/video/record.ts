/** Official Gemini Omni Flash record. Verified 28 September 2026. */
export const OMNI_RECORD = {
  provider: "Google Gemini API",
  model: "gemini-omni-1.1-flash",
  product: "Gemini Omni Flash",
  verifiedOn: "2026-09-28",
  docs: "https://ai.google.dev/gemini-api/docs/omni",
  modelCard: "https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash",
  pricingDocs: "https://ai.google.dev/gemini-api/docs/pricing",
  endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions",
  aspects: ["9:16", "16:9"] as const,
  durationMin: 3,
  durationMax: 10,
  pricePerSecond720p: 0.1,
  audio: "prompt",
  dialogue: "prompt",
} as const;

export const OMNI_COST_NOTE =
  "COST UNKNOWN until the clip length is known. The published 720p rate is about $0.10 per second (5,792 video tokens per second at $17.50 per 1M tokens). Output length is 3 to 10 seconds. Input tokens are extra. This is not a receipt.";

export function omniCostNote(durationSeconds: number | null) {
  if (durationSeconds == null) return OMNI_COST_NOTE;
  const approx = Math.round(durationSeconds * OMNI_RECORD.pricePerSecond720p * 100) / 100;
  return `About $${approx.toFixed(2)} for ${durationSeconds}s at the published 720p rate of $0.10 per second. Input tokens are extra. This is not a receipt.`;
}
