export type ProductionExecutor = {
  id: string;
  kind: "human" | "image" | "video" | "drive" | "external_api" | "grok";
  active: boolean;
  note: string;
};

/** Future adapters stay inactive. Only a person can complete an asset. */
export const EXECUTORS: ProductionExecutor[] = [
  { id: "human", kind: "human", active: true, note: "Human executor. A pack is instructions until someone confirms the asset exists." },
  { id: "image", kind: "image", active: true, note: "Image files are made by the Production Executor when Hayden asks. An image is not a finished video." },
  { id: "video", kind: "video", active: true, note: "Scene clips are made when Hayden asks, using Gemini Omni Flash if the Gemini key is set. A scene clip is not the assembled video." },
  { id: "drive", kind: "drive", active: false, note: "Drive delivery is not connected." },
  { id: "external-api", kind: "external_api", active: false, note: "External production APIs are not connected." },
  { id: "grok", kind: "grok", active: false, note: "Grok Bot is not connected." },
];

export function activeExecutor() {
  return EXECUTORS.find((executor) => executor.active) ?? EXECUTORS[0];
}
