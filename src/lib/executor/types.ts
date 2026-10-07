export const ASSET_ROLES = [
  "STORYBOARD_FRAME",
  "START_FRAME",
  "END_FRAME",
  "REFERENCE_IMAGE",
  "CHARACTER_REFERENCE",
  "LOCATION_REFERENCE",
  "SCENE_VIDEO",
  "OTHER",
] as const;

export type AssetRole = (typeof ASSET_ROLES)[number];

export const GENERATION_STATUSES = [
  "QUEUED",
  "SUBMITTED",
  "GENERATING",
  "DOWNLOADING",
  "COMPLETE",
  "FAILED",
  "NEEDS_REVIEW",
  "APPROVED",
  "REJECTED",
  "REGENERATING",
  "PLANNING",
  "READY_TO_GENERATE",
  "AI_QA",
  "AI_QA_FAILED",
  "NEEDS_HAYDEN",
  "BLOCKED",
] as const;

export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const FILE_BACKED_STATUSES = new Set<GenerationStatus>(["COMPLETE", "NEEDS_REVIEW", "APPROVED", "REJECTED", "NEEDS_HAYDEN", "AI_QA_FAILED"]);

export type AssetMetadata = {
  errorCode?: string;
  feedback?: string;
  referenceAssetIds?: string[];
  referencesSent?: number;
  continuityNote?: string;
  characterLock?: "UNKNOWN" | "unsupported";
  usageImages?: number;
  usageInputImages?: number;
  costUsd?: number | null;
  costBasis?: string;
  costStatus?: "list_price" | "unknown";
  aspectNote?: string;
  providerJobId?: string | null;
  startFrameAssetId?: string;
  endFrameAssetId?: string;
  durationRequested?: number | null;
  durationActual?: number | null;
  costNote?: string;
  qualityMode?: "draft" | "standard" | "hero";
  apiQuality?: "low" | "medium";
  resolution?: "1k" | "2k";
  qa?: "pass" | "unresolved";
  attempt?: number;
  audioInPrompt?: boolean;
  continuityCheck?: string;
};

export type ImageReference = {
  assetId: string;
  bytes: Buffer;
  mimeType: string;
};

export type ImageRequest = {
  prompt: string;
  aspectRatio: string;
  references: ImageReference[];
  quality?: "low" | "medium";
  resolution?: "1k" | "2k";
};

export type ImageSuccess = {
  ok: true;
  bytes: Buffer;
  mimeType: string;
  width: number | null;
  height: number | null;
  model: string;
  providerJobId: string | null;
};

export type ImageFailure = {
  ok: false;
  message: string;
  code: "timeout" | "moderation" | "invalid_prompt" | "unsupported_aspect_ratio" | "api" | "not_configured" | "unsupported" | "download";
};

export type ImageResult = ImageSuccess | ImageFailure;

export type ImageGenerationProvider = {
  id: string;
  model: string;
  connected: boolean;
  limitations: string[];
  generate(request: ImageRequest): Promise<ImageResult>;
};

export type VideoGenerationRequest = {
  prompt: string;
  startFrameAssetId?: string | null;
  endFrameAssetId?: string | null;
};

export type VideoFrameInput = {
  bytes: Buffer;
  mimeType: string;
};

export type VideoSubmitInput = {
  prompt: string;
  aspectRatio: "9:16" | "16:9";
  startFrame: VideoFrameInput;
  endFrame: VideoFrameInput;
};

export type VideoSubmitResult =
  | {
      ok: true;
      jobId: string;
      state: "submitted" | "generating" | "downloading" | "complete";
      bytes?: Buffer;
      mimeType?: string;
      providerMetadata?: Record<string, unknown>;
    }
  | { ok: false; code: "timeout" | "moderation" | "api" | "download" | "not_configured" | "unsupported" | "invalid_frame"; message: string };

export type VideoGenerationProvider = {
  id: string;
  model: string;
  connected: boolean;
  limitations: string[];
  generate(request: VideoGenerationRequest): Promise<{ ok: false; code: "unsupported"; message: string }>;
  submit(input: VideoSubmitInput): Promise<VideoSubmitResult>;
  retrieve(jobId: string): Promise<VideoSubmitResult>;
};

export type AudioGenerationProvider = {
  id: string;
  connected: false;
  generate(): Promise<{ ok: false; code: "unsupported"; message: string }>;
};

export type StoredFile = {
  absolutePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

export type AssetStorageProvider = {
  id: string;
  root(): string;
  write(assetId: string, bytes: Buffer, mimeType: string): StoredFile;
  read(absolutePath: string): Buffer | null;
  exists(absolutePath: string): boolean;
};

export type GenerationReport = {
  packId: string;
  created: string[];
  skipped: string[];
  failed: Array<{ sceneNumber: number | null; role: string; message: string; assetId: string }>;
};
