import { IMAGE_PROVIDER_RECORD } from "@/lib/executor/pricing";
import { sniffImage } from "@/lib/executor/storage";
import type { AudioGenerationProvider, ImageFailure, ImageGenerationProvider, ImageRequest, ImageResult, VideoGenerationProvider, VideoGenerationRequest, VideoSubmitResult } from "@/lib/executor/types";
import { geminiVideoProvider } from "@/lib/executor/video/gemini";
import { OMNI_RECORD } from "@/lib/executor/video/record";

export const SUPPORTED_ASPECT_RATIOS = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "19.5:9",
  "9:19.5",
  "20:9",
  "9:20",
  "21:9",
  "5:2",
  "auto",
]);

export function imageConfig() {
  const provider = (process.env.IMAGE_PROVIDER || "xai").trim().toLowerCase();
  const model = (process.env.IMAGE_MODEL || IMAGE_PROVIDER_RECORD.model).trim();
  const ownKey = process.env.IMAGE_API_KEY?.trim() || "";
  const sharedKey = provider === "xai" ? process.env.AI_API_KEY?.trim() || "" : "";
  const key = ownKey || sharedKey;
  return {
    provider,
    model,
    key,
    configured: provider === "xai" && key.length > 0 && model.length > 0,
  };
}

let override: ImageGenerationProvider | null = null;

export function setImageProvider(provider: ImageGenerationProvider | null) {
  override = provider;
}

export function imageProvider(): ImageGenerationProvider {
  if (override) return override;
  return xaiImageProvider();
}

export function xaiImageProvider(): ImageGenerationProvider {
  const config = imageConfig();
  return {
    id: "xai",
    model: config.model,
    connected: config.configured,
    limitations: [...IMAGE_PROVIDER_RECORD.limitations],
    async generate(request) {
      if (!config.configured) {
        return { ok: false, code: "not_configured", message: "Image generation is not configured. Set IMAGE_API_KEY, or AI_API_KEY with IMAGE_PROVIDER=xai." };
      }
      if (!SUPPORTED_ASPECT_RATIOS.has(request.aspectRatio)) {
        return { ok: false, code: "unsupported_aspect_ratio", message: `Unsupported aspect ratio: ${request.aspectRatio}` };
      }
      return requestXai(config.key, config.model, request);
    },
  };
}

const disconnectedVideo: VideoGenerationProvider = {
  id: "video",
  model: OMNI_RECORD.model,
  connected: false,
  limitations: ["GEMINI_API_KEY is not set. No scene video can be submitted."],
  async generate() {
    return { ok: false, code: "unsupported", message: "Video generation is not connected." };
  },
  async submit(): Promise<VideoSubmitResult> {
    return { ok: false, code: "not_configured", message: "The Gemini API key is not set, so no video job was submitted." };
  },
  async retrieve(): Promise<VideoSubmitResult> {
    return { ok: false, code: "not_configured", message: "The Gemini API key is not set, so the job cannot be checked." };
  },
};

let videoOverride: VideoGenerationProvider | null = null;

export function videoConfig() {
  const key = process.env.GEMINI_API_KEY?.trim() || "";
  const model = (process.env.VIDEO_MODEL || OMNI_RECORD.model).trim();
  return { provider: "gemini" as const, model, key, configured: key.length > 0 };
}

export function setVideoProvider(provider: VideoGenerationProvider | null) {
  videoOverride = provider;
}

export function getVideoProvider(): VideoGenerationProvider {
  if (videoOverride) return videoOverride;
  const config = videoConfig();
  if (!config.configured) return disconnectedVideo;
  return geminiVideoProvider(config.key, config.model);
}

export const videoProvider = {
  get connected() {
    return getVideoProvider().connected;
  },
  generate(request: VideoGenerationRequest) {
    return getVideoProvider().generate(request);
  },
};

export const audioProvider: AudioGenerationProvider = {
  id: "audio",
  connected: false,
  async generate() {
    return { ok: false, code: "unsupported", message: "Audio generation is not connected." };
  },
};

async function requestXai(key: string, model: string, request: ImageRequest): Promise<ImageResult> {
  const edited = request.references.length > 0;
  const reference = request.references[0];
  const endpoint = edited ? IMAGE_PROVIDER_RECORD.editEndpoint : IMAGE_PROVIDER_RECORD.generateEndpoint;
  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    aspect_ratio: request.aspectRatio,
    resolution: request.resolution ?? "1k",
    quality: request.quality ?? "medium",
    response_format: "b64_json",
    n: 1,
  };
  if (edited && reference) {
    const mime = reference.mimeType || "image/png";
    body.image = { url: `data:${mime};base64,${reference.bytes.toString("base64")}`, type: "image_url" };
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, code: timedOut ? "timeout" : "api", message: timedOut ? "The image provider timed out." : "The image provider could not be reached." };
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    model?: string;
    error?: { message?: string };
    message?: string;
  } | null;
  if (!response.ok || !payload) {
    const message = payload?.error?.message || payload?.message || `The image provider returned ${response.status}.`;
    return { ok: false, code: failureCode(response.status, message), message };
  }
  const first = payload.data?.[0];
  const bytes = await imageBytes(first);
  if (!bytes) {
    const message = payload.error?.message || "The provider returned no image file.";
    return { ok: false, code: failureCode(response.status, message), message };
  }
  const sniffed = sniffImage(bytes);
  if (sniffed.mimeType === "application/octet-stream" || bytes.length < 32) {
    return { ok: false, code: "download", message: "The provider response was not a readable image file." };
  }
  return {
    ok: true,
    bytes,
    mimeType: sniffed.mimeType,
    width: sniffed.width,
    height: sniffed.height,
    model: payload.model || model,
    providerJobId: null,
  };
}

async function imageBytes(first: { b64_json?: string; url?: string } | undefined) {
  if (!first) return null;
  if (first.b64_json) {
    const bytes = Buffer.from(first.b64_json, "base64");
    return bytes.length > 0 ? bytes : null;
  }
  if (!first.url) return null;
  try {
    const response = await fetch(first.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function failureCode(status: number, message: string): ImageFailure["code"] {
  const text = message.toLowerCase();
  if (/moderat|safety|content policy|rejected/.test(text)) return "moderation";
  if (/aspect/.test(text)) return "unsupported_aspect_ratio";
  if (status === 400) return "invalid_prompt";
  return "api";
}
