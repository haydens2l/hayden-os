import type { Metadata } from "next";
import Link from "next/link";
import { retryGpuRenderAction, reviewGpuRenderAction, startGpuAction, stopGpuAction, submitGpuRenderAction } from "@/lib/actions";
import { HowLink } from "@/components/shell/how-link";
import { DEFAULT_PROMPT, GPU_MODEL, GPU_NAME } from "@/lib/gpu/benchmark";
import { formatClock, formatUsd } from "@/lib/gpu/cost";
import { syncGpu } from "@/lib/gpu/control";
import { economicsLines } from "@/lib/gpu/report";
import { gpuConfig } from "@/lib/gpu/runpod";
import { activeSession, currentSession, infra, listJobs } from "@/lib/gpu/store";
import { secondsBetween } from "@/lib/gpu/cost";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "GPU test" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function GpuTestPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const notice = (await searchParams).notice;
  const db = getDb();
  const config = gpuConfig();
  let syncError = "";
  if (config.configured) {
    try {
      await syncGpu(db);
    } catch (error) {
      syncError = error instanceof Error ? error.message : "The GPU status could not be checked.";
    }
  }
  const session = activeSession(db) ?? currentSession(db);
  const jobs = listJobs(db);
  const volume = infra(db);
  const money = economicsLines(session, jobs);
  const billing = Boolean(session && !session.stopped_at && ["STARTING", "RUNNING", "ERROR"].includes(session.status));
  const live = billing || jobs.some((job) => ["QUEUED", "RENDERING", "DOWNLOADING"].includes(job.status));

  return (
    <>
      {live ? <meta httpEquiv="refresh" content="15" /> : null}
      <header className="page-header">
        <p className="kicker">Content</p>
        <h1>GPU test</h1>
        <p className="lede">One Property Made Simple scene on a rented RTX 4090. Wan 2.2 TI2V-5B, start frame only. You approve the clip.</p>
        <p className="row-actions">
          <Link href="/production">Production board</Link>
        </p>
        <HowLink href="/help#gpu-test" />
      </header>
      {notice ? <p className="lede">{notice}</p> : null}
      {syncError ? <p className="lede">{syncError}</p> : null}

      <section className="section">
        <h2>Machine</h2>
        <p>Provider: {config.provider}. GPU target: {GPU_NAME}. Model: {GPU_MODEL}.</p>
        <p>Runpod key: {config.apiKey ? "saved" : "missing"}. Worker token: {config.workerToken ? "saved" : "missing"}.</p>
        <p>
          {session
            ? `${session.status}. ${session.phase_detail || "No worker update yet."}`
            : "No GPU session yet. Starting one is what begins billing."}
        </p>
        {session?.error ? <p>{session.error}</p> : null}
        {session ? (
          <>
            <p>Hourly GPU rate: {session.gpu_hourly_usd == null ? "Not returned yet" : `${formatUsd(session.gpu_hourly_usd)} per hour`}{session.rate_source ? ` (${session.rate_source})` : ""}.</p>
            <p>Startup and model load: {session.ready_at ? money.readyClock : "Still starting"}.</p>
            <p>GPU session time: {money.sessionClock}. This includes startup, model load, generation, retries, idle time, and the wait until stop.</p>
            <p>
              <strong>GPU session cost: {money.sessionCost}.</strong> This is the production infrastructure cost for the machine. Divide this by approved seconds.
            </p>
            <p>Generation-only total for this session: {money.generationCost}. That number leaves out startup, loading, idle time, and shutdown. It is not the production cost.</p>
            <p>Time in this session that was not the render itself: {money.overheadCost}.</p>
            <p>Approved video in this session: {money.approvedSeconds > 0 ? `${money.approvedSeconds} seconds` : "none yet"}. {money.perSecondCost}</p>
          </>
        ) : (
          <p>Hourly GPU rate, session cost, and generation cost appear after the machine starts. Nothing is billing yet.</p>
        )}
        <p>
          Weight storage: {volume ? `${volume.volume_gb ?? "unknown"} GB in ${volume.data_center || "an unrecorded data center"}` : "not created yet"}. Storage rate:{" "}
          {volume?.volume_hourly_usd == null ? "Runpod did not return one, so storage cost is unknown" : `${formatUsd(volume.volume_hourly_usd)} per hour`}. Storage is separate from the GPU session cost.
        </p>
        {billing ? <p>This GPU is billing now, including while this page stays open.</p> : null}
        <form action={billing ? stopGpuAction : startGpuAction}>
          <button type="submit">{billing ? "Stop GPU" : "Start GPU"}</button>
        </form>
      </section>

      <section className="section">
        <h2>Scene</h2>
        <p>First proof: 16:9, 5 seconds, 1280×704. 9:16 and 6 or 8 seconds are the next tests. Wan accepts 704×1280, but that run is not the first proof.</p>
        <form action={submitGpuRenderAction} className="stack">
          <label>
            Start frame
            <input name="start" type="file" accept="image/png,image/jpeg,image/webp" required />
          </label>
          <label>
            End frame, unused
            <input name="end" type="file" accept="image/png,image/jpeg,image/webp" />
          </label>
          <p>An end frame is saved on this machine and is not sent to TI2V-5B.</p>
          <label>
            Length
            <select name="seconds" defaultValue="5">
              <option value="5">5 seconds</option>
              <option value="6">6 seconds</option>
              <option value="8">8 seconds</option>
            </select>
          </label>
          <label>
            Frame
            <select name="aspect" defaultValue="16:9">
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
            </select>
          </label>
          <label>
            Prompt
            <textarea name="prompt" rows={5} defaultValue={DEFAULT_PROMPT} />
          </label>
          <label>
            Seed, optional
            <input name="seed" inputMode="numeric" />
          </label>
          <button type="submit">Generate</button>
        </form>
      </section>

      <section className="section">
        <h2>Attempts</h2>
        {jobs.length === 0 ? <p>No scene has been sent.</p> : null}
        {jobs.map((job) => {
          const seconds = secondsBetween(job.generation_started_at, job.generation_completed_at);
          const settings = job.settings_json ? (JSON.parse(job.settings_json) as { size?: string; frameNum?: number; seed?: number; endFrameUsed?: boolean }) : {};
          return (
            <article key={job.id}>
              <p>
                Attempt {job.attempt_number}: {job.status}. {job.aspect_ratio}, {job.duration_seconds} seconds requested
                {job.duration_actual != null ? `, ${job.duration_actual} seconds in the file` : ""}.
              </p>
              <p>
                Generation time: {formatClock(seconds)}. Generation cost: {formatUsd(job.generation_cost_usd)}. This is the render only.
              </p>
              <p>
                Model {job.model}. Size {settings.size || `${job.width}×${job.height}`}. Frames {settings.frameNum ?? "default"}. Seed {job.seed ?? settings.seed ?? "unset"}. End frame used: no.
              </p>
              {job.failure_reason ? <p>{job.failure_reason}</p> : null}
              {job.asset_id && job.status !== "FAILED" ? <video src={`/api/assets/${job.asset_id}`} controls playsInline /> : null}
              {job.status === "NEEDS_REVIEW" ? (
                <form action={reviewGpuRenderAction} className="row-actions">
                  <input type="hidden" name="jobId" value={job.id} />
                  <button name="decision" value="APPROVED" type="submit">
                    Approve
                  </button>
                  <button name="decision" value="REJECTED" type="submit">
                    Reject
                  </button>
                </form>
              ) : null}
              {job.start_frame_path ? (
                <form action={retryGpuRenderAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <button type="submit">Generate again</button>
                </form>
              ) : null}
            </article>
          );
        })}
      </section>
    </>
  );
}
