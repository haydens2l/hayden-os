import type { GpuSessionRow, RenderJobRow } from "@/lib/gpu/store";
import { formatClock, formatUsd, perApprovedSecond, secondsBetween, usdForSeconds } from "@/lib/gpu/cost";

export function economics(session: GpuSessionRow | undefined, jobs: RenderJobRow[], now = Date.now()) {
  const sessionJobs = session ? jobs.filter((job) => job.session_id === session.id) : [];
  const sessionSeconds = session ? secondsBetween(session.started_at, session.stopped_at, now) : null;
  const readySeconds = session?.ready_at ? secondsBetween(session.started_at, session.ready_at, now) : null;
  const sessionUsd = usdForSeconds(session?.gpu_hourly_usd ?? null, sessionSeconds);
  const attempts = sessionJobs.map((job) => {
    const seconds = secondsBetween(job.generation_started_at, job.generation_completed_at, now);
    const usd = job.generation_cost_usd ?? usdForSeconds(session?.gpu_hourly_usd ?? null, seconds);
    return { job, seconds, usd };
  });
  const generationUsd = attempts.reduce((sum, attempt) => sum + (attempt.usd ?? 0), 0);
  const generationKnown = attempts.some((attempt) => attempt.usd != null);
  const approvedSeconds = sessionJobs
    .filter((job) => job.status === "APPROVED")
    .reduce((sum, job) => sum + (job.duration_actual ?? job.duration_seconds ?? 0), 0);
  const overheadUsd = sessionUsd != null && generationKnown ? Math.max(0, sessionUsd - generationUsd) : null;
  return {
    sessionSeconds,
    readySeconds,
    sessionUsd,
    generationUsd: generationKnown ? generationUsd : null,
    overheadUsd,
    approvedSeconds,
    perSecond: perApprovedSecond(sessionUsd, approvedSeconds),
    attempts,
    running: session?.status === "STARTING" || session?.status === "RUNNING",
  };
}

export function economicsLines(session: GpuSessionRow | undefined, jobs: RenderJobRow[], now = Date.now()) {
  const report = economics(session, jobs, now);
  return {
    ...report,
    sessionClock: formatClock(report.sessionSeconds),
    readyClock: formatClock(report.readySeconds),
    sessionCost: formatUsd(report.sessionUsd),
    generationCost: formatUsd(report.generationUsd),
    overheadCost: formatUsd(report.overheadUsd),
    perSecondCost: report.perSecond == null ? "Not available until a clip is approved" : `${formatUsd(report.perSecond)} of GPU session cost per approved second. Storage is not included.`,
  };
}
