import { OMNI_RECORD } from "@/lib/executor/video/record";
import type { VideoGenerationProvider, VideoSubmitInput, VideoSubmitResult } from "@/lib/executor/types";

type OmniBody = {
  model: string;
  background: true;
  store: true;
  input: Array<{ type: "image"; data: string; mime_type: string } | { type: "text"; text: string }>;
  response_format: { type: "video"; aspect_ratio: "9:16" | "16:9"; delivery: "uri" };
  generation_config: { video_config: { resolution: "720p" } };
};

export function buildOmniBody(input: VideoSubmitInput, model: string): OmniBody {
  return {
    model,
    background: true,
    store: true,
    input: [
      { type: "image", data: input.startFrame.bytes.toString("base64"), mime_type: input.startFrame.mimeType },
      { type: "image", data: input.endFrame.bytes.toString("base64"), mime_type: input.endFrame.mimeType },
      { type: "text", text: input.prompt },
    ],
    response_format: { type: "video", aspect_ratio: input.aspectRatio, delivery: "uri" },
    generation_config: { video_config: { resolution: "720p" } },
  };
}

type InteractionPayload = {
  id?: string;
  status?: string;
  error?: { message?: string } | string;
  output_video?: { data?: string; uri?: string; mime_type?: string };
};

function failureCode(status: number, message: string): Extract<VideoSubmitResult, { ok: false }>["code"] {
  const text = message.toLowerCase();
  if (/moderat|safety|blocked|policy/.test(text)) return "moderation";
  if (status === 408 || /timeout|timed out/.test(text)) return "timeout";
  return "api";
}

function messageFrom(payload: InteractionPayload | null, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload.error === "string") return payload.error;
  if (payload.error?.message) return payload.error.message;
  return fallback;
}

function videoBytes(payload: InteractionPayload) {
  const data = payload.output_video?.data;
  if (!data) return null;
  const bytes = Buffer.from(data, "base64");
  return bytes.length > 12 ? bytes : null;
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as InteractionPayload & { name?: string; state?: string | { name?: string } };
  } catch {
    return null;
  }
}

export function geminiVideoProvider(key: string, model: string = OMNI_RECORD.model): VideoGenerationProvider {
  return {
    id: "gemini",
    model,
    connected: true,
    limitations: [
      "Exact duration cannot be set. Output is 3 to 10 seconds.",
      "Aspect ratios are 9:16 and 16:9.",
      "Audio, dialogue, sound effects, and music are steered in the prompt. An audio file cannot be uploaded.",
      "Subject reference images are a separate task and are not sent with the start and end frames.",
    ],
    async generate() {
      return { ok: false, code: "unsupported", message: "Use Generate video on the pack. A prompt alone is not a scene." };
    },
    async submit(input) {
      return createInteraction(key, model, input);
    },
    async retrieve(jobId) {
      return retrieveInteraction(key, jobId);
    },
  };
}

async function createInteraction(key: string, model: string, input: VideoSubmitInput): Promise<VideoSubmitResult> {
  let response: Response;
  try {
    response = await fetch(OMNI_RECORD.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(buildOmniBody(input, model)),
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, code: timedOut ? "timeout" : "api", message: timedOut ? "The provider did not accept the job in time." : "The provider could not be reached." };
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const message = messageFrom(payload, `Provider request failed (${response.status}).`);
    return { ok: false, code: failureCode(response.status, message), message };
  }
  return interpret(key, payload, "The provider accepted the request without a job id.");
}

async function retrieveInteraction(key: string, jobId: string): Promise<VideoSubmitResult> {
  let response: Response;
  try {
    response = await fetch(`${OMNI_RECORD.endpoint}/${encodeURIComponent(jobId)}`, {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return { ok: false, code: "api", message: "The provider job could not be checked." };
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const message = messageFrom(payload, `Provider job check failed (${response.status}).`);
    return { ok: false, code: failureCode(response.status, message), message };
  }
  return interpret(key, payload, "The provider job has no video yet.");
}

async function interpret(key: string, payload: InteractionPayload | null, emptyMessage: string): Promise<VideoSubmitResult> {
  const jobId = payload?.id ?? "";
  const status = (payload?.status ?? "").toLowerCase();
  const failed = status === "failed" || status === "error" || status === "cancelled";
  if (failed) return { ok: false, code: failureCode(400, messageFrom(payload, "The provider marked the job as failed.")), message: messageFrom(payload, "The provider marked the job as failed.") };
  const inline = payload ? videoBytes(payload) : null;
  if (inline) {
    return { ok: true, jobId, state: "complete", bytes: inline, mimeType: "video/mp4", providerMetadata: { status: payload?.status ?? "completed" } };
  }
  const uri = payload?.output_video?.uri;
  if (uri) {
    const downloaded = await downloadUri(key, uri);
    if (downloaded.ok === false && downloaded.code === "download" && /not active/i.test(downloaded.message)) {
      return { ok: true, jobId, state: "downloading", providerMetadata: { status: payload?.status ?? "processing", uri: true } };
    }
    if (downloaded.ok) return { ...downloaded, jobId: jobId || downloaded.jobId };
    if (!jobId) return downloaded;
  }
  if (!jobId) return { ok: false, code: "api", message: emptyMessage };
  return { ok: true, jobId, state: status === "completed" ? "downloading" : "generating", providerMetadata: { status: payload?.status ?? "processing" } };
}

async function downloadUri(key: string, uri: string): Promise<VideoSubmitResult> {
  const fileId = uri.split("/").filter(Boolean).pop() ?? "";
  if (!fileId) return { ok: false, code: "download", message: "The provider did not return a video file." };
  const infoResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/files/${fileId}`, {
    headers: { "x-goog-api-key": key },
    signal: AbortSignal.timeout(20000),
  });
  const info = await readJson(infoResponse);
  const stateName = typeof info?.state === "string" ? info.state : info?.state?.name ?? "";
  if (stateName && stateName !== "ACTIVE") {
    if (stateName === "FAILED") return { ok: false, code: "download", message: "The provider file failed while processing." };
    return { ok: false, code: "download", message: "The provider file is not active yet." };
  }
  const media = await fetch(`https://generativelanguage.googleapis.com/v1beta/files/${fileId}:download?alt=media`, {
    headers: { "x-goog-api-key": key },
    signal: AbortSignal.timeout(60000),
  });
  if (!media.ok) return { ok: false, code: "download", message: `The video download failed (${media.status}).` };
  const bytes = Buffer.from(await media.arrayBuffer());
  if (bytes.length < 12) return { ok: false, code: "download", message: "The downloaded video was empty." };
  return { ok: true, jobId: fileId, state: "complete", bytes, mimeType: "video/mp4", providerMetadata: { fileId } };
}
