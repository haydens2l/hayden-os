import type Database from "better-sqlite3";
import { localAssetStorage } from "@/lib/executor/storage";
import { FILE_BACKED_STATUSES, type AssetMetadata, type AssetRole, type GenerationStatus } from "@/lib/executor/types";

export type AssetRow = {
  id: string;
  production_pack_id: string | null;
  scene_id: string | null;
  concept_id: string | null;
  organisation_id: string | null;
  project_id: string | null;
  asset_type: string;
  asset_role: string;
  provider: string | null;
  model: string | null;
  prompt: string | null;
  aspect_ratio: string | null;
  width: number | null;
  height: number | null;
  generation_status: GenerationStatus;
  generation_job_id: string | null;
  storage_location: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
  completed_at: string | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  parent_asset_id: string | null;
  version: number;
  metadata: string | null;
  error_message: string | null;
  start_frame_asset_id: string | null;
  end_frame_asset_id: string | null;
  duration_requested: number | null;
  duration_actual: number | null;
  provider_metadata: string | null;
  cost_note: string | null;
  started_at: string | null;
};

export function parseAssetMeta(raw: string | null): AssetMetadata {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as AssetMetadata;
  } catch {
    return {};
  }
}

export function insertAsset(
  db: Database.Database,
  input: {
    id: string;
    packId: string;
    sceneId: string | null;
    conceptId: string | null;
    organisationId: string | null;
    projectId: string | null;
    role: AssetRole;
    prompt: string;
    aspectRatio: string;
    parentId: string | null;
    version: number;
    status: GenerationStatus;
    metadata: AssetMetadata;
  },
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO generated_assets (
      id, production_pack_id, scene_id, concept_id, organisation_id, project_id, asset_type, asset_role,
      prompt, aspect_ratio, generation_status, created_at, created_by, parent_asset_id, version, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, 'image', ?, ?, ?, ?, ?, 'hayden', ?, ?, ?)`,
  ).run(
    input.id,
    input.packId,
    input.sceneId,
    input.conceptId,
    input.organisationId,
    input.projectId,
    input.role,
    input.prompt,
    input.aspectRatio,
    input.status,
    now,
    input.parentId,
    input.version,
    JSON.stringify(input.metadata),
  );
}

export function updateAsset(
  db: Database.Database,
  id: string,
  patch: Partial<{
    status: GenerationStatus;
    provider: string;
    model: string;
    width: number | null;
    height: number | null;
    storageLocation: string | null;
    fileName: string | null;
    mimeType: string | null;
    fileSize: number | null;
    completedAt: string | null;
    errorMessage: string | null;
    generationJobId: string | null;
    metadata: AssetMetadata;
    prompt: string;
    startFrameAssetId: string | null;
    endFrameAssetId: string | null;
    durationRequested: number | null;
    durationActual: number | null;
    providerMetadata: string | null;
    costNote: string | null;
    startedAt: string | null;
  }>,
) {
  const current = getAsset(db, id);
  if (!current) throw new Error("That asset record is missing.");
  const status = patch.status ?? current.generation_status;
  const location = patch.storageLocation === undefined ? current.storage_location : patch.storageLocation;
  const size = patch.fileSize === undefined ? current.file_size : patch.fileSize;
  if (FILE_BACKED_STATUSES.has(status)) {
    const storage = localAssetStorage();
    if (!location || !size || size < 1 || !storage.exists(location)) {
      throw new Error("A file cannot be marked ready unless it is stored.");
    }
  }
  db.prepare(
    `UPDATE generated_assets SET
      generation_status = ?, provider = COALESCE(?, provider), model = COALESCE(?, model),
      width = ?, height = ?, storage_location = ?, file_name = ?, mime_type = ?, file_size = ?,
      completed_at = ?, error_message = ?, generation_job_id = COALESCE(?, generation_job_id),
      metadata = COALESCE(?, metadata), prompt = COALESCE(?, prompt),
      start_frame_asset_id = COALESCE(?, start_frame_asset_id),
      end_frame_asset_id = COALESCE(?, end_frame_asset_id),
      duration_requested = COALESCE(?, duration_requested),
      duration_actual = ?,
      provider_metadata = COALESCE(?, provider_metadata),
      cost_note = COALESCE(?, cost_note),
      started_at = COALESCE(?, started_at)
     WHERE id = ?`,
  ).run(
    status,
    patch.provider ?? null,
    patch.model ?? null,
    patch.width === undefined ? current.width : patch.width,
    patch.height === undefined ? current.height : patch.height,
    location,
    patch.fileName === undefined ? current.file_name : patch.fileName,
    patch.mimeType === undefined ? current.mime_type : patch.mimeType,
    size,
    patch.completedAt === undefined ? current.completed_at : patch.completedAt,
    patch.errorMessage === undefined ? current.error_message : patch.errorMessage,
    patch.generationJobId ?? null,
    patch.metadata ? JSON.stringify(patch.metadata) : null,
    patch.prompt ?? null,
    patch.startFrameAssetId === undefined ? null : patch.startFrameAssetId,
    patch.endFrameAssetId === undefined ? null : patch.endFrameAssetId,
    patch.durationRequested === undefined ? null : patch.durationRequested,
    patch.durationActual === undefined ? current.duration_actual : patch.durationActual,
    patch.providerMetadata === undefined ? null : patch.providerMetadata,
    patch.costNote === undefined ? null : patch.costNote,
    patch.startedAt === undefined ? null : patch.startedAt,
    id,
  );
}

export function getAsset(db: Database.Database, id: string) {
  return db.prepare(`SELECT * FROM generated_assets WHERE id = ?`).get(id) as AssetRow | undefined;
}

export function listPackAssets(db: Database.Database, packId: string) {
  return db.prepare(`SELECT * FROM generated_assets WHERE production_pack_id = ? ORDER BY version`).all(packId) as AssetRow[];
}

export function latestForRole(assets: AssetRow[], sceneId: string, role: AssetRole) {
  return assets
    .filter((asset) => asset.scene_id === sceneId && asset.asset_role === role)
    .sort((a, b) => b.version - a.version);
}

export function displayAsset(assets: AssetRow[]) {
  return assets.find((asset) => asset.file_size && asset.file_size > 0 && asset.generation_status !== "FAILED") ?? null;
}

export function countReadyAssets(db: Database.Database, packId: string) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM generated_assets
       WHERE production_pack_id = ? AND file_size > 0 AND generation_status IN ('NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETE')`,
    )
    .get(packId) as { n: number };
  return row.n;
}

export function reviewAsset(db: Database.Database, id: string, decision: "APPROVED" | "REJECTED") {
  const asset = getAsset(db, id);
  if (!asset) throw new Error("That file is not stored.");
  const storage = localAssetStorage();
  if (!asset.storage_location || !asset.file_size || !storage.exists(asset.storage_location)) {
    throw new Error("There is no file to review.");
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE generated_assets SET generation_status = ?, approved_by = 'hayden', approved_at = ? WHERE id = ?`).run(decision, now, id);
}

export function usageSummary(db: Database.Database) {
  const rows = db.prepare(`SELECT provider, model, generation_status, metadata, file_size FROM generated_assets`).all() as Array<{
    provider: string | null;
    model: string | null;
    generation_status: string;
    metadata: string | null;
    file_size: number | null;
  }>;
  let knownUsd = 0;
  let knownCount = 0;
  let unknownCount = 0;
  let files = 0;
  let failed = 0;
  const byModel = new Map<string, number>();
  for (const row of rows) {
    if (row.generation_status === "FAILED") failed += 1;
    if (row.file_size && row.file_size > 0) files += 1;
    const meta = parseAssetMeta(row.metadata);
    const key = `${row.provider ?? "unset"} · ${row.model ?? "unset"}`;
    byModel.set(key, (byModel.get(key) ?? 0) + 1);
    if (meta.costStatus === "list_price" && typeof meta.costUsd === "number") {
      knownUsd += meta.costUsd;
      knownCount += 1;
    } else if (!["QUEUED", "SUBMITTED", "GENERATING", "DOWNLOADING", "REGENERATING"].includes(row.generation_status)) {
      unknownCount += 1;
    }
  }
  return {
    generations: rows.length,
    files,
    failed,
    knownUsd,
    knownCount,
    unknownCount,
    byModel: [...byModel.entries()].map(([label, count]) => ({ label, count })),
  };
}

export function nextVersion(db: Database.Database, parentId: string | null) {
  if (!parentId) return 1;
  const parent = getAsset(db, parentId);
  return (parent?.version ?? 0) + 1;
}
