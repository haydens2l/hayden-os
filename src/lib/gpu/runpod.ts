import fs from "node:fs";
import path from "node:path";
import { GPU_NAME, POD_NAME, VOLUME_GB, VOLUME_NAME, WORKER_PORT } from "@/lib/gpu/benchmark";

const API = "https://api.runpod.io/v2";

export type GpuConfig = {
  provider: string;
  apiKey: string;
  workerToken: string;
  workerUrl: string;
  configured: boolean;
};

export function gpuConfig(): GpuConfig {
  const apiKey = process.env.RUNPOD_API_KEY?.trim() || "";
  const workerToken = process.env.GPU_WORKER_TOKEN?.trim() || "";
  const workerUrl = process.env.GPU_WORKER_URL?.trim() || "";
  return {
    provider: process.env.GPU_PROVIDER?.trim() || "runpod",
    apiKey,
    workerToken,
    workerUrl,
    configured: Boolean(apiKey && workerToken),
  };
}

export class RunpodError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Json = Record<string, unknown>;

async function runpod(apiKey: string, method: string, pathname: string, body?: Json) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { detail: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const detail = parsed && typeof parsed === "object" && "detail" in parsed ? String((parsed as Json).detail) : text.slice(0, 500);
    throw new RunpodError(response.status, detail || `Runpod returned ${response.status}.`);
  }
  return parsed;
}

function listOf(body: unknown, keys: string[]) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const record = body as Json;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

export type DataCenterChoice = { id: string; gpuId: string; availability: string };

const RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function list4090(body: unknown) {
  const centers = listOf(body, ["dataCenters", "datacenters"]);
  const choices: Array<DataCenterChoice & { region: string }> = [];
  for (const center of centers) {
    if (!center || typeof center !== "object") continue;
    const row = center as Json;
    const id = typeof row.id === "string" ? row.id : "";
    const region = typeof row.region === "string" ? row.region : "";
    const gpus = Array.isArray(row.gpuAvailability) ? row.gpuAvailability : [];
    for (const gpu of gpus) {
      if (!gpu || typeof gpu !== "object") continue;
      const item = gpu as Json;
      const gpuId = typeof item.id === "string" ? item.id : "";
      const availability = typeof item.availability === "string" ? item.availability : "NONE";
      if (!/4090/.test(gpuId) || availability === "NONE") continue;
      choices.push({ id, gpuId, availability, region });
    }
  }
  choices.sort((a, b) => {
    const region = Number(b.region === "OCEANIA") - Number(a.region === "OCEANIA");
    if (region !== 0) return region;
    return (RANK[a.availability] ?? 9) - (RANK[b.availability] ?? 9);
  });
  return choices;
}

export function chooseDataCenter(body: unknown): DataCenterChoice | null {
  return list4090(body)[0] ?? null;
}

export async function find4090DataCenters(apiKey: string) {
  const body = await runpod(apiKey, "GET", "/catalog/datacenters?include=GPU_AVAILABILITY");
  return list4090(body);
}

export async function listVolumes(apiKey: string) {
  const body = await runpod(apiKey, "GET", "/network-volumes");
  return listOf(body, ["networkVolumes", "volumes"]).filter((item) => item && typeof item === "object") as Json[];
}

export async function ensureVolume(apiKey: string, dataCenter: string) {
  const existing = (await listVolumes(apiKey)).find((volume) => volume.name === VOLUME_NAME);
  if (existing && typeof existing.id === "string") {
    return {
      id: existing.id,
      dataCenter: typeof existing.dataCenter === "string" ? existing.dataCenter : dataCenter,
      size: typeof existing.size === "number" ? existing.size : VOLUME_GB,
      created: false,
    };
  }
  const created = (await runpod(apiKey, "POST", "/network-volumes", {
    name: VOLUME_NAME,
    dataCenter,
    size: VOLUME_GB,
    type: "STANDARD",
  })) as Json;
  if (typeof created.id !== "string") throw new RunpodError(500, "Runpod did not return a network volume id.");
  return {
    id: created.id,
    dataCenter: typeof created.dataCenter === "string" ? created.dataCenter : dataCenter,
    size: typeof created.size === "number" ? created.size : VOLUME_GB,
    created: true,
  };
}

export async function listPods(apiKey: string) {
  const body = await runpod(apiKey, "GET", "/pods");
  return listOf(body, ["pods"]).filter((item) => item && typeof item === "object") as Json[];
}

export function workerFiles() {
  const root = path.join(process.cwd(), "gpu-worker");
  const bootstrap = fs.readFileSync(path.join(root, "bootstrap.sh"));
  const server = fs.readFileSync(path.join(root, "server.py"));
  return {
    bootstrap: bootstrap.toString("base64"),
    server: server.toString("base64"),
  };
}

export function proxyUrl(podId: string) {
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

export async function createPod(apiKey: string, input: { dataCenter: string; volumeId: string; gpuId: string; token: string }) {
  const files = workerFiles();
  const created = (await runpod(apiKey, "POST", "/pods", {
    name: POD_NAME,
    image: "runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404",
    cloud: "SECURE",
    gpu: { id: input.gpuId || GPU_NAME, count: 1 },
    disk: 50,
    dataCenterIds: [input.dataCenter],
    ports: [`${WORKER_PORT}/http`],
    mounts: { network: [{ volumeId: input.volumeId, path: "/runpod-volume" }] },
    env: {
      GPU_WORKER_TOKEN: input.token,
      BOOTSTRAP_B64: files.bootstrap,
      SERVER_B64: files.server,
      PORT: String(WORKER_PORT),
    },
    entrypoint: ["/bin/bash", "-lc"],
    cmd: [
      "mkdir -p /opt/hayden-worker && printf '%s' \"$BOOTSTRAP_B64\" | base64 -d > /opt/hayden-worker/bootstrap.sh && printf '%s' \"$SERVER_B64\" | base64 -d > /opt/hayden-worker/server.py && bash /opt/hayden-worker/bootstrap.sh",
    ],
  })) as Json;
  if (typeof created.id !== "string") throw new RunpodError(500, "Runpod did not return a pod id.");
  return created;
}

export async function podAction(apiKey: string, podId: string, action: "start" | "stop") {
  return runpod(apiKey, "POST", `/pods/${encodeURIComponent(podId)}/action`, { action });
}

export async function getPod(apiKey: string, podId: string) {
  return (await runpod(apiKey, "GET", `/pods/${encodeURIComponent(podId)}`)) as Json;
}

export function hourlyRate(pod: Json) {
  return typeof pod.cost === "number" && pod.cost > 0 ? pod.cost : null;
}
