/** Official xAI rate card. Verified 28 September 2026. https://docs.x.ai/developers/pricing */
export const IMAGE_PROVIDER_RECORD = {
  provider: "xAI",
  model: "grok-imagine-image-2.0",
  verifiedOn: "2026-09-28",
  generateEndpoint: "https://api.x.ai/v1/images/generations",
  editEndpoint: "https://api.x.ai/v1/images/edits",
  docs: "https://docs.x.ai/developers/model-capabilities/images/generation",
  pricingDocs: "https://docs.x.ai/developers/pricing",
  listPriceUsd: 0.04,
  capabilities: [
    "Text to image",
    "Aspect ratios include 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9",
    "Resolution 1k or 2k. Hayden OS pins 1k.",
    "Quality low, medium, or auto. Official docs, 5 Oct 2026: no high setting. Auto uses low for a new image. Hayden OS sends medium unless Hayden picks draft.",
    "A file comes back as base64, or as a temporary URL that must be downloaded immediately",
    "An edit can take one source image. The guide also says up to five source images are supported",
  ],
  limitations: [
    "Character identity lock is UNKNOWN. A reference image can be sent. The same face is not guaranteed.",
    "A temporary URL is not treated as the stored asset.",
    "The API response does not include the billed amount.",
    "An edit is billed for the input image and the output. The rate card publishes the output price. The input amount is UNKNOWN.",
    "This image API does not make scene video. Scene video is Gemini Omni Flash, and only when that key is set.",
  ],
} as const;

const LIST_PRICES: Record<string, number> = {
  "grok-imagine-image-2.0": 0.04,
  "grok-imagine-image": 0.02,
  "grok-imagine-image-quality": 0.05,
};

export function imageListPrice(model: string, edited: boolean) {
  const output = LIST_PRICES[model];
  if (output == null) {
    return { costUsd: null as number | null, costStatus: "unknown" as const, costBasis: "UNKNOWN. This model is not on the verified xAI rate card." };
  }
  if (edited) {
    return {
      costUsd: null as number | null,
      costStatus: "unknown" as const,
      costBasis: `The output list price for ${model} is $${output.toFixed(2)}. An edit also bills the input image. That input amount is not on the rate card, so the total is UNKNOWN.`,
    };
  }
  return {
    costUsd: output,
    costStatus: "list_price" as const,
    costBasis: `xAI rate card verified ${IMAGE_PROVIDER_RECORD.verifiedOn}. $${output.toFixed(2)} per image for ${model}. This is the published model price. The API did not return a receipt. A separate price for medium or 2k was not on that card.`,
  };
}
