import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { assetRoot, mp4DurationSeconds, safePath } from "@/lib/executor/storage";

export type GpuSessionRow = {
  id: string;
  provider: string;
  external_id: string | null;
  gpu_name: string | null;
  data_center: string | null;
  volume_id: string | null;
  volume_gb: number | null;
  gpu_hourly_usd: number | null;
  rate_source: string | null;
  status: string;
  worker_url: string | null;
  phase: string | null;
  phase_detail: string | null;
  started_at: string | null;
  ready_at: string | null;
  stopped_at: string | null;
  provider_started_at: string | null;
  error: string | null;
  created_at: string;
};

export type RenderJobRow = {
  id: string;
  session_id: string | null;
  asset_id: string | null;
  model: string;
  aspect_ratio: string;
  duration_seconds: number;
  width: number | null;
  height: number | null;
  start_frame_path: string | null;
  end_frame_path: string | null;
  prompt: string;
  seed: number | null;
  status: string;
  attempt_number: number;
  parent_job_id: string | null;
  created_at: string;
  generation_started_at: string | null;
  generation_completed_at: string | null;
  output_path: string | null;
  duration_actual: number | null;
  failure_reason: string | null;
  settings_json: string | null;
  generation_cost_usd: number | null;
  cost_status: string | null;
  approved_at: string | null;
  rejected_at: string | null;
};

export type InfraRow = {
  id: string;
  volume_id: string | null;
  volume_name: string | null;
  volume_gb: number | null;
  data_center: string | null;
  volume_hourly_usd: number | null;
  volume_rate_source: string | null;
  created_at: string;
};

export function renderRoot(jobId: string) {
  const root = path.resolve(assetRoot());
  const folder = path.resolve(root, "renders", jobId);
  if (folder !== root && !folder.startsWith(`${root}${path.sep}`)) throw new Error("The render path left storage.");
  return folder;
}

export function writeRenderFile(jobId: string, name: string, bytes: Buffer) {
  const folder = renderRoot(jobId);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.resolve(folder, name);
  if (!file.startsWith(`${folder}${path.sep}`) && file !== folder) throw new Error("The render file left the job folder.");
  fs.writeFileSync(file, bytes);
  return file;
}

export function readRenderFile(absolutePath: string) {
  const safe = safePath(absolutePath);
  if (!safe || !fs.existsSync(safe)) return null;
  return fs.readFileSync(safe);
}

export function clipSeconds(bytes: Buffer) {
  return mp4DurationSeconds(bytes);
}

export function currentSession(db: Database.Database) {
  return db.prepare(`SELECT * FROM gpu_sessions ORDER BY created_at DESC LIMIT 1`).get() as GpuSessionRow | undefined;
}

export function activeSession(db: Database.Database) {
  return db
    .prepare(`SELECT * FROM gpu_sessions WHERE status IN ('STARTING', 'RUNNING', 'ERROR') AND stopped_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .get() as GpuSessionRow | undefined;
}

export function listJobs(db: Database.Database) {
  return db.prepare(`SELECT * FROM render_jobs ORDER BY created_at DESC LIMIT 12`).all() as RenderJobRow[];
}

export function getJob(db: Database.Database, id: string) {
  return db.prepare(`SELECT * FROM render_jobs WHERE id = ?`).get(id) as RenderJobRow | undefined;
}

export function infra(db: Database.Database) {
  return db.prepare(`SELECT * FROM gpu_infra WHERE id = 'runpod'`).get() as InfraRow | undefined;
}

export function saveInfra(db: Database.Database, row: { volumeId: string; volumeGb: number; dataCenter: string; createdAt: string }) {
  db.prepare(
    `INSERT INTO gpu_infra (id, volume_id, volume_name, volume_gb, data_center, created_at)
     VALUES ('runpod', ?, 'hayden-os-wan-weights', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET volume_id = excluded.volume_id, volume_gb = excluded.volume_gb, data_center = excluded.data_center`,
  ).run(row.volumeId, row.volumeGb, row.dataCenter, row.createdAt);
}
