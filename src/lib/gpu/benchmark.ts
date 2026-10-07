export const GPU_MODEL = "Wan2.2-TI2V-5B";
export const GPU_TASK = "ti2v-5B";
export const GPU_NAME = "NVIDIA GeForce RTX 4090";
export const VOLUME_NAME = "hayden-os-wan-weights";
export const POD_NAME = "hayden-os-wan";
export const VOLUME_GB = 80;
export const WORKER_PORT = 8000;
export const DEFAULT_PROMPT =
  "Claymation, Property Made Simple. A small clay homeowner sits at a kitchen table and looks at a wall calendar. Warm practical light, handmade textures, a slow restrained camera move. No logos. No on-screen text.";

export function frameNum(seconds: number) {
  const frames = Math.round(seconds * 24);
  const aligned = Math.round((frames - 1) / 4) * 4 + 1;
  return Math.max(5, aligned);
}

export function sizeFor(aspect: string) {
  if (aspect === "9:16") return { size: "704*1280", width: 704, height: 1280, proven: false };
  return { size: "1280*704", width: 1280, height: 704, proven: true };
}
