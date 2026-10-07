import { randomUUID, randomInt } from "node:crypto";
import type Database from "better-sqlite3";
import { clipSeconds, getJob, infra, readRenderFile, saveInfra, writeRenderFile, type GpuSessionRow, type RenderJobRow } from "@/lib/gpu/store";
import { DEFAULT_PROMPT, GPU_MODEL, GPU_NAME, GPU_TASK, POD_NAME, frameNum, sizeFor } from "@/lib/gpu/benchmark";
import { usdForSeconds, secondsBetween } from "@/lib/gpu/cost";
import {
  createPod,
  ensureVolume,
  find4090DataCenters,
  getPod,
  gpuConfig,
  hourlyRate,
  listPods,
  podAction,
  proxyUrl,
  type Json,
} from "@/lib/gpu/runpod";

function now() {
  return new Date().toISOString();
}

function insertSession(db: Database.Database, row: Partial<GpuSessionRow> & { id: string; status: string }) {
  const stamp = now();
  db.prepare(
    `INSERT INTO gpu_sessions (
      id, provider, external_id, gpu_name, data_center, volume_id, volume_gb, gpu_hourly_usd, rate_source,
      status, worker_url, phase, phase_detail, started_at, ready_at, stopped_at, error, provider_started_at, created_at
    ) VALUES (?, 'runpod', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.external_id ?? null,
    row.gpu_name ?? GPU_NAME,
    row.data_center ?? null,
    row.volume_id ?? null,
    row.volume_gb ?? null,
    row.gpu_hourly_usd ?? null,
    row.rate_source ?? null,
    row.status,
    row.worker_url ?? null,
    row.phase ?? null,
    row.phase_detail ?? null,
    row.started_at ?? stamp,
    row.ready_at ?? null,
    row.stopped_at ?? null,
    row.error ?? null,
    row.provider_started_at ?? null,
    stamp,
  );
}

function patchSession(db: Database.Database, id: string, patch: Record<string, string | number | null>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE gpu_sessions SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((key) => patch[key]), id);
}

export async function startGpu(db: Database.Database) {
  const config = gpuConfig();
  if (!config.apiKey || !config.workerToken) {
    throw new Error("Add RUNPOD_API_KEY and GPU_WORKER_TOKEN to the Hayden OS .env file, then restart the app.");
  }
  const open = db.prepare(`SELECT id FROM gpu_sessions WHERE status IN ('STARTING', 'RUNNING', 'ERROR') AND stopped_at IS NULL LIMIT 1`).get();
  if (open) throw new Error("A GPU is already running. Stop it before starting another. It bills until you stop it.");

  const centers = await find4090DataCenters(config.apiKey);
  if (!centers.length) throw new Error("No RTX 4090 is free on Runpod right now. Nothing was started.");
  const preferred = centers[0];
  const volume = await ensureVolume(config.apiKey, preferred.id);
  const placed = centers.find((center) => center.id === volume.dataCenter) ?? (volume.created ? preferred : null);
  if (!placed) {
    throw new Error(`The model volume is in ${volume.dataCenter}. No RTX 4090 is available in that data center right now. A second volume was not created.`);
  }
  saveInfra(db, { volumeId: volume.id, volumeGb: volume.size, dataCenter: volume.dataCenter, createdAt: infra(db)?.created_at || now() });

  const pods = await listPods(config.apiKey);
  const named = pods.find((pod) => pod.name === POD_NAME && pod.status !== "TERMINATED");
  let pod: Json;
  let adopted = false;
  if (named && typeof named.id === "string") {
    pod = named;
    const status = typeof named.status === "string" ? named.status : "";
    adopted = status === "RUNNING" || status === "PROVISIONING" || status === "STARTING";
    if (status === "EXITED" || status === "ERROR") {
      await podAction(config.apiKey, named.id, "start");
      pod = await getPod(config.apiKey, named.id);
    }
  } else {
    pod = await createPod(config.apiKey, {
      dataCenter: placed.id,
      volumeId: volume.id,
      gpuId: placed.gpuId,
      token: config.workerToken,
    });
  }
  const externalId = String(pod.id);
  const rate = hourlyRate(pod);
  insertSession(db, {
    id: randomUUID(),
    external_id: externalId,
    gpu_name: placed.gpuId || GPU_NAME,
    data_center: typeof pod.dataCenterId === "string" ? pod.dataCenterId : placed.id,
    volume_id: volume.id,
    volume_gb: volume.size,
    gpu_hourly_usd: rate,
    rate_source: rate == null ? null : "Runpod pod cost field",
    status: "STARTING",
    worker_url: config.workerUrl || proxyUrl(externalId),
    phase: "starting",
    phase_detail: adopted
      ? "This GPU was already on. The session clock starts now. Any earlier billing is on the Runpod invoice and is not in this session."
      : "Runpod accepted the GPU. The worker still has to install Wan and confirm the weights.",
    started_at: now(),
    provider_started_at: typeof pod.startedAt === "string" ? pod.startedAt : null,
  });
}

export async function stopGpu(db: Database.Database) {
  const config = gpuConfig();
  const session = db.prepare(`SELECT * FROM gpu_sessions WHERE status IN ('STARTING', 'RUNNING', 'ERROR') AND stopped_at IS NULL ORDER BY created_at DESC LIMIT 1`).get() as GpuSessionRow | undefined;
  if (!session) throw new Error("No GPU is running.");
  if (!config.apiKey) throw new Error("RUNPOD_API_KEY is missing, so Hayden OS cannot stop the pod.");
  if (session.external_id) await podAction(config.apiKey, session.external_id, "stop");
  patchSession(db, session.id, { status: "STOPPED", stopped_at: now(), phase: "stopped", phase_detail: "Runpod accepted the stop. A short invoice delay can still appear on the Runpod bill." });
}

async function workerJson(url: string, token: string, pathname: string, init?: RequestInit) {
  const response = await fetch(`${url.replace(/\/$/, "")}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(init?.method === "POST" ? 60_000 : 20_000),
  });
  if (pathname.endsWith("/video")) {
    if (!response.ok) throw new Error(`The worker did not return the MP4 (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }
  const body = (await response.json().catch(() => ({}))) as Json;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Worker returned ${response.status}.`);
  return body;
}

function rememberCost(db: Database.Database, session: GpuSessionRow, job: RenderJobRow) {
  const seconds = secondsBetween(job.generation_started_at, job.generation_completed_at);
  const usd = usdForSeconds(session.gpu_hourly_usd, seconds);
  if (usd == null || job.generation_cost_usd === usd) return;
  db.prepare(`UPDATE render_jobs SET generation_cost_usd = ?, cost_status = ? WHERE id = ?`).run(usd, session.gpu_hourly_usd == null ? "unknown" : "provider", job.id);
}

export async function syncGpu(db: Database.Database) {
  const config = gpuConfig();
  const session = db.prepare(`SELECT * FROM gpu_sessions WHERE status IN ('STARTING', 'RUNNING', 'ERROR') AND stopped_at IS NULL ORDER BY created_at DESC LIMIT 1`).get() as GpuSessionRow | undefined;
  if (!session || !config.apiKey || !session.external_id) return session;
  try {
    const pod = await getPod(config.apiKey, session.external_id);
    const rate = hourlyRate(pod);
    const status = typeof pod.status === "string" ? pod.status : "";
    const patch: Record<string, string | number | null> = {};
    if (rate != null) {
      patch.gpu_hourly_usd = rate;
      patch.rate_source = "Runpod pod cost field";
    }
    if (typeof pod.startedAt === "string") patch.provider_started_at = pod.startedAt;
    if (typeof pod.dataCenterId === "string") patch.data_center = pod.dataCenterId;
    if (status === "EXITED" || status === "TERMINATED") {
      patch.status = "STOPPED";
      patch.stopped_at = session.stopped_at || now();
      patch.phase = "stopped";
    } else if (status === "ERROR") {
      patch.status = "ERROR";
      patch.error = "Runpod reported the pod in ERROR.";
    } else if (session.worker_url && config.workerToken) {
      try {
        const health = (await workerJson(session.worker_url, config.workerToken, "/health")) as Json;
        patch.phase = typeof health.phase === "string" ? health.phase : "starting";
        patch.phase_detail = typeof health.detail === "string" ? health.detail : null;
        if (health.ok === true) {
          patch.status = "RUNNING";
          patch.ready_at = session.ready_at || now();
          patch.error = null;
        } else {
          patch.status = "STARTING";
        }
      } catch {
        patch.status = "STARTING";
        patch.phase = "starting";
        patch.phase_detail = "The GPU is up. The worker has not answered yet. The first start installs Wan and downloads the weights onto the volume.";
      }
    }
    patchSession(db, session.id, patch);
  } catch (error) {
    patchSession(db, session.id, { error: error instanceof Error ? error.message : "Runpod could not be checked." });
  }

  const fresh = db.prepare(`SELECT * FROM gpu_sessions WHERE id = ?`).get(session.id) as GpuSessionRow;
  const pending = db.prepare(`SELECT * FROM render_jobs WHERE session_id = ? AND status IN ('QUEUED', 'RENDERING', 'DOWNLOADING')`).all(session.id) as RenderJobRow[];
  for (const job of pending) {
    if (!fresh.worker_url || !config.workerToken) continue;
    try {
      const remote = (await workerJson(fresh.worker_url, config.workerToken, `/jobs/${job.id}`)) as Json;
      const remoteStatus = typeof remote.status === "string" ? remote.status : "";
      if (remoteStatus === "RENDERING" || remoteStatus === "QUEUED") {
        db.prepare(`UPDATE render_jobs SET status = 'RENDERING', failure_reason = NULL WHERE id = ?`).run(job.id);
        if (typeof remote.generationStartedAt === "string") {
          db.prepare(`UPDATE render_jobs SET generation_started_at = COALESCE(generation_started_at, ?) WHERE id = ?`).run(remote.generationStartedAt, job.id);
        }
      } else if (remoteStatus === "FAILED") {
        db.prepare(`UPDATE render_jobs SET status = 'FAILED', failure_reason = ?, generation_completed_at = COALESCE(generation_completed_at, ?) WHERE id = ?`).run(
          typeof remote.error === "string" ? remote.error.slice(0, 2000) : "The worker failed.",
          typeof remote.generationCompletedAt === "string" ? remote.generationCompletedAt : now(),
          job.id,
        );
      } else if (remoteStatus === "COMPLETE") {
        db.prepare(`UPDATE render_jobs SET status = 'DOWNLOADING', generation_started_at = COALESCE(generation_started_at, ?), generation_completed_at = COALESCE(generation_completed_at, ?) WHERE id = ?`).run(
          typeof remote.generationStartedAt === "string" ? remote.generationStartedAt : null,
          typeof remote.generationCompletedAt === "string" ? remote.generationCompletedAt : now(),
          job.id,
        );
        const bytes = (await workerJson(fresh.worker_url, config.workerToken, `/jobs/${job.id}/video`)) as Buffer;
        const output = writeRenderFile(job.id, "attempt.mp4", bytes);
        const duration = clipSeconds(bytes);
        const assetId = randomUUID();
        const seconds = secondsBetween(
          typeof remote.generationStartedAt === "string" ? remote.generationStartedAt : job.generation_started_at,
          typeof remote.generationCompletedAt === "string" ? remote.generationCompletedAt : now(),
        );
        const cost = usdForSeconds(fresh.gpu_hourly_usd, seconds);
        db.prepare(
          `INSERT INTO generated_assets (
            id, asset_type, asset_role, provider, model, prompt, aspect_ratio, width, height,
            generation_status, generation_job_id, storage_location, file_name, mime_type, file_size,
            created_at, completed_at, created_by, version, duration_requested, duration_actual, cost_note, started_at, metadata
          ) VALUES (?, 'video', 'SCENE_VIDEO', 'runpod', ?, ?, ?, ?, ?, 'NEEDS_REVIEW', ?, ?, ?, 'video/mp4', ?, ?, ?, 'hayden', ?, ?, ?, ?, ?, ?)`,
        ).run(
          assetId,
          GPU_MODEL,
          job.prompt,
          job.aspect_ratio,
          job.width,
          job.height,
          job.id,
          output,
          `attempt.mp4`,
          bytes.length,
          job.created_at,
          now(),
          job.attempt_number,
          job.duration_seconds,
          duration,
          "This note is the generation clock only. The GPU session cost, including startup, model load, idle time, and stop delay, is on the GPU test page.",
          typeof remote.generationStartedAt === "string" ? remote.generationStartedAt : job.generation_started_at,
          JSON.stringify({ endFrameUsed: false, task: GPU_TASK }),
        );
        db.prepare(
          `UPDATE render_jobs SET status = 'NEEDS_REVIEW', asset_id = ?, output_path = ?, duration_actual = ?, generation_cost_usd = ?, cost_status = ?, generation_started_at = COALESCE(generation_started_at, ?), generation_completed_at = COALESCE(generation_completed_at, ?) WHERE id = ?`,
        ).run(
          assetId,
          output,
          duration,
          cost,
          fresh.gpu_hourly_usd == null ? "unknown" : "provider",
          typeof remote.generationStartedAt === "string" ? remote.generationStartedAt : null,
          typeof remote.generationCompletedAt === "string" ? remote.generationCompletedAt : now(),
          job.id,
        );
      }
    } catch (error) {
      db.prepare(`UPDATE render_jobs SET failure_reason = ? WHERE id = ? AND status IN ('QUEUED', 'RENDERING', 'DOWNLOADING')`).run(
        error instanceof Error ? error.message : "The job could not be checked.",
        job.id,
      );
    }
  }
  const latest = db.prepare(`SELECT * FROM gpu_sessions WHERE id = ?`).get(session.id) as GpuSessionRow;
  const jobs = db.prepare(`SELECT * FROM render_jobs WHERE session_id = ?`).all(session.id) as RenderJobRow[];
  for (const job of jobs) rememberCost(db, latest, job);
  return latest;
}

export async function submitRender(
  db: Database.Database,
  input: { prompt: string; aspect: string; seconds: number; start: Buffer; end: Buffer | null; seed: number | null },
) {
  const config = gpuConfig();
  await syncGpu(db);
  const session = db.prepare(`SELECT * FROM gpu_sessions WHERE status = 'RUNNING' ORDER BY created_at DESC LIMIT 1`).get() as GpuSessionRow | undefined;
  if (!session?.worker_url) throw new Error("The GPU is not ready. Start it, wait until the worker says ready, then generate.");
  if (session.phase !== "ready") throw new Error(session.phase_detail || "The model is still loading. That time is session cost, not a generation.");
  const size = sizeFor(input.aspect);
  const frames = frameNum(input.seconds);
  const id = randomUUID();
  const startPath = writeRenderFile(id, "start", input.start);
  const endPath = input.end ? writeRenderFile(id, "end-unused", input.end) : null;
  const seed = input.seed ?? randomInt(1, 2_147_483_647);
  const settings = {
    task: GPU_TASK,
    model: GPU_MODEL,
    size: size.size,
    frameNum: frames,
    fpsAssumption: 24,
    offloadModel: true,
    convertModelDtype: true,
    t5Cpu: true,
    endFrameUsed: false,
    seed,
  };
  db.prepare(
    `INSERT INTO render_jobs (
      id, session_id, model, aspect_ratio, duration_seconds, width, height, start_frame_path, end_frame_path,
      prompt, seed, status, attempt_number, created_at, settings_json, cost_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', 1, ?, ?, 'unknown')`,
  ).run(id, session.id, GPU_MODEL, input.aspect, input.seconds, size.width, size.height, startPath, endPath, input.prompt.trim() || DEFAULT_PROMPT, seed, now(), JSON.stringify(settings));
  await workerJson(session.worker_url, config.workerToken, "/jobs", {
    method: "POST",
    body: JSON.stringify({
      id,
      prompt: input.prompt.trim() || DEFAULT_PROMPT,
      imageBase64: input.start.toString("base64"),
      size: size.size,
      frameNum: frames,
      seed,
    }),
  });
  db.prepare(`UPDATE render_jobs SET status = 'RENDERING' WHERE id = ?`).run(id);
  return id;
}

export async function reviewRender(db: Database.Database, jobId: string, decision: "APPROVED" | "REJECTED") {
  const job = getJob(db, jobId);
  if (!job || job.status !== "NEEDS_REVIEW") throw new Error("That clip is not waiting for review.");
  const stamp = now();
  if (decision === "APPROVED") {
    const bytes = job.output_path ? readRenderFile(job.output_path) : null;
    if (bytes) writeRenderFile(job.id, "approved.mp4", bytes);
    db.prepare(`UPDATE render_jobs SET status = 'APPROVED', approved_at = ? WHERE id = ?`).run(stamp, job.id);
    if (job.asset_id) db.prepare(`UPDATE generated_assets SET generation_status = 'APPROVED', approved_by = 'hayden', approved_at = ? WHERE id = ?`).run(stamp, job.asset_id);
    return;
  }
  db.prepare(`UPDATE render_jobs SET status = 'REJECTED', rejected_at = ? WHERE id = ?`).run(stamp, job.id);
  if (job.asset_id) db.prepare(`UPDATE generated_assets SET generation_status = 'REJECTED' WHERE id = ?`).run(job.asset_id);
}

export async function retryRender(db: Database.Database, jobId: string) {
  const previous = getJob(db, jobId);
  if (!previous?.start_frame_path) throw new Error("There is no start frame to run again.");
  const bytes = readRenderFile(previous.start_frame_path);
  if (!bytes) throw new Error("The start frame file is missing.");
  const end = previous.end_frame_path ? readRenderFile(previous.end_frame_path) : null;
  const created = await submitRender(db, {
    prompt: previous.prompt,
    aspect: previous.aspect_ratio,
    seconds: previous.duration_seconds,
    start: bytes,
    end,
    seed: null,
  });
  db.prepare(`UPDATE render_jobs SET attempt_number = ?, parent_job_id = ? WHERE id = ?`).run(previous.attempt_number + 1, previous.id, created);
}
