import type Database from "better-sqlite3";
import { STALE_DAYS, type WorkItem, type WorkStage } from "@/lib/work/types";

type BlockerRow = {
  source_type: string;
  source_id: string;
  reason: string;
  waiting_on: string;
  needs_hayden: number;
  created_at: string;
};

type OutcomeRow = {
  source_type: string;
  source_id: string;
  completed_at: string;
  summary: string;
};

function openBlockers(db: Database.Database) {
  return db
    .prepare(`SELECT source_type, source_id, reason, waiting_on, needs_hayden, created_at FROM work_blockers WHERE cleared_at IS NULL`)
    .all() as BlockerRow[];
}

function outcomes(db: Database.Database) {
  return db.prepare(`SELECT source_type, source_id, completed_at, summary FROM work_outcomes`).all() as OutcomeRow[];
}

function latestChange(db: Database.Database, sourceType: string, sourceId: string) {
  const row = db
    .prepare(
      `SELECT review_status FROM work_submissions WHERE source_type = ? AND source_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(sourceType, sourceId) as { review_status: string } | undefined;
  return row?.review_status ?? null;
}

function item(partial: WorkItem): WorkItem {
  return partial;
}

export function listWork(db: Database.Database): WorkItem[] {
  const blockers = openBlockers(db);
  const done = outcomes(db);
  const items = [...packs(db, blockers, done), ...tasks(db), ...decisions(db), ...concepts(db), ...jobs(db)];
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getWork(db: Database.Database, sourceType: string, sourceId: string) {
  return listWork(db).find((row) => row.sourceType === sourceType && row.sourceId === sourceId) ?? null;
}

export function haydenQueue(db: Database.Database) {
  return listWork(db).filter((row) => row.haydenRequired && row.stage !== "COMPLETE" && row.stage !== "CANCELLED");
}

export function reviewQueue(db: Database.Database) {
  return haydenQueue(db).filter((row) => row.stage === "READY FOR REVIEW");
}

function packs(db: Database.Database, blockers: BlockerRow[], done: OutcomeRow[]) {
  const rows = db
    .prepare(
      `SELECT p.id, p.brand, p.production_type, p.organisation_id, p.project_id, p.production_owner, p.status, p.due_date,
              p.created_at, p.updated_at, p.creative_concept_id, o.name AS org_name, pr.name AS project_name, pe.name AS owner_name,
              c.title AS concept_title, c.objective AS concept_objective
       FROM production_packs p
       LEFT JOIN organisations o ON o.id = p.organisation_id
       LEFT JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN people pe ON pe.id = p.production_owner
       LEFT JOIN creative_concepts c ON c.id = p.creative_concept_id
       WHERE NOT EXISTS (SELECT 1 FROM production_packs newer WHERE newer.supersedes_id = p.id)`,
    )
    .all() as Array<Record<string, string | null>>;

  return rows.map((row) => {
    const blocker = blockers.find((entry) => entry.source_type === "production_pack" && entry.source_id === row.id);
    const outcome = done.find((entry) => entry.source_type === "production_pack" && entry.source_id === row.id);
    const review = latestChange(db, "production_pack", String(row.id));
    const stage = packStage(String(row.status), review, Boolean(blocker));
    const haydenRequired = stage === "READY FOR REVIEW" || stage === "NEEDS HAYDEN" || (stage === "BLOCKED" && blocker?.needs_hayden === 1);
    const title = row.concept_title || `${row.brand ?? "Production"} ${row.production_type ?? "pack"}`;
    return item({
      id: `production_pack:${row.id}`,
      sourceType: "production_pack",
      sourceId: String(row.id),
      organisation: row.org_name,
      organisationId: row.organisation_id,
      project: row.project_name,
      projectId: row.project_id,
      title,
      objective: row.concept_objective,
      ownerType: row.production_owner ? "human" : "unassigned",
      ownerId: row.production_owner,
      ownerName: row.owner_name,
      status: String(row.status),
      stage,
      priority: null,
      haydenRequired,
      haydenAction: haydenRequired ? haydenAction(stage, title, blocker?.reason ?? null) : null,
      blockedReason: blocker?.reason ?? null,
      waitingOn: blocker?.waiting_on ?? null,
      nextAction: nextFor(stage, row.owner_name),
      dueDate: row.due_date,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: outcome?.completed_at ?? null,
      outcome: outcome?.summary ?? null,
      href: stage === "READY FOR REVIEW" ? `/work/pack/${row.id}/review` : `/work/pack/${row.id}`,
    });
  });
}

function packStage(status: string, review: string | null, blocked: boolean): WorkStage {
  if (status === "archived") return "CANCELLED";
  if (status === "complete") return "COMPLETE";
  if (blocked || status === "blocked") return "BLOCKED";
  if (review === "changes" && status !== "ready_for_review" && status !== "complete") return "CHANGES REQUESTED";
  if (status === "ready_for_review") return "READY FOR REVIEW";
  if (status === "in_production") return "IN PROGRESS";
  if (status === "assigned") return "ASSIGNED";
  if (status === "approved") return "READY FOR EXECUTION";
  if (status === "needs_review" || status === "draft") return "NEEDS HAYDEN";
  return "IDEA";
}

function haydenAction(stage: WorkStage, title: string, reason: string | null) {
  if (stage === "READY FOR REVIEW") return `Review ${title}`;
  if (stage === "BLOCKED") return reason ? `Resolve blocker: ${reason}` : "Resolve blocker";
  if (stage === "NEEDS HAYDEN") return "Approve the production pack";
  return "Needs a decision";
}

function nextFor(stage: WorkStage, owner: string | null) {
  if (stage === "READY FOR REVIEW") return "Hayden reviews the submitted version.";
  if (stage === "CHANGES REQUESTED") return `${owner ?? "The executor"} makes another version.`;
  if (stage === "IN PROGRESS") return `${owner ?? "The executor"} is making it.`;
  if (stage === "ASSIGNED") return `${owner ?? "The executor"} starts.`;
  if (stage === "BLOCKED") return "Waiting. Hayden is interrupted only if the blocker needs him.";
  if (stage === "READY FOR EXECUTION") return "Assign an executor.";
  if (stage === "COMPLETE") return "Nothing. It is finished.";
  if (stage === "CANCELLED") return "Nothing. It was marked not worth doing.";
  if (stage === "NEEDS HAYDEN") return "Hayden approves the direction.";
  if (stage === "AI WORKING") return "An agent is working.";
  return "Waiting for a next step.";
}

function tasks(db: Database.Database): WorkItem[] {
  const rows = db
    .prepare(
      `SELECT t.*, o.name AS org_name, pr.name AS project_name, pe.name AS owner_name
       FROM tasks t
       LEFT JOIN organisations o ON o.id = t.organisation_id
       LEFT JOIN projects pr ON pr.id = t.project_id
       LEFT JOIN people pe ON pe.id = t.owner_id
       WHERE t.status NOT IN ('done', 'dismissed')`,
    )
    .all() as Array<Record<string, string | number | null>>;
  return rows.map((row) => {
    const status = String(row.status);
    const stage = taskStage(status);
    const needs = Number(row.requires_hayden) === 1 || stage === "NEEDS HAYDEN";
    return item({
      id: `task:${row.id}`,
      sourceType: "task",
      sourceId: String(row.id),
      organisation: stringOrNull(row.org_name),
      organisationId: stringOrNull(row.organisation_id),
      project: stringOrNull(row.project_name),
      projectId: stringOrNull(row.project_id),
      title: String(row.title),
      objective: stringOrNull(row.description),
      ownerType: row.owner_id ? "human" : "unassigned",
      ownerId: stringOrNull(row.owner_id),
      ownerName: stringOrNull(row.owner_name),
      status,
      stage,
      priority: stringOrNull(row.priority),
      haydenRequired: needs && stage !== "COMPLETE",
      haydenAction: needs ? stringOrNull(row.recommended_action) ?? "Decide" : null,
      blockedReason: status === "blocked" ? stringOrNull(row.why_it_matters) : null,
      waitingOn: status === "waiting" || status === "blocked" ? stringOrNull(row.recommended_action) : null,
      nextAction: stringOrNull(row.recommended_action) ?? nextFor(stage, stringOrNull(row.owner_name)),
      dueDate: stringOrNull(row.due_date),
      createdAt: String(row.created_at),
      updatedAt: String(row.created_at),
      completedAt: stringOrNull(row.completed_at),
      outcome: null,
      href: `/work/task/${row.id}`,
    });
  });
}

function taskStage(status: string): WorkStage {
  if (status === "in_progress") return "IN PROGRESS";
  if (status === "blocked") return "BLOCKED";
  if (status === "delegated") return "ASSIGNED";
  if (status === "waiting") return "BLOCKED";
  if (status === "open") return "READY FOR EXECUTION";
  return "IDEA";
}

function decisions(db: Database.Database): WorkItem[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.title, d.context, d.status, d.deadline, d.created_at, d.decision_owner_id, d.organisation_id, d.project_id,
              o.name AS org_name, pr.name AS project_name, pe.name AS owner_name
       FROM decisions d
       LEFT JOIN organisations o ON o.id = d.organisation_id
       LEFT JOIN projects pr ON pr.id = d.project_id
       LEFT JOIN people pe ON pe.id = d.decision_owner_id
       WHERE d.status = 'open'`,
    )
    .all() as Array<Record<string, string | null>>;
  return rows.map((row) => {
    const ownerId = row.decision_owner_id;
    const needs = !ownerId || ownerId === "hayden";
    return item({
      id: `decision:${row.id}`,
      sourceType: "decision",
      sourceId: String(row.id),
      organisation: row.org_name,
      organisationId: row.organisation_id,
      project: row.project_name,
      projectId: row.project_id,
      title: String(row.title),
      objective: row.context,
      ownerType: ownerId ? "human" : "unassigned",
      ownerId,
      ownerName: row.owner_name,
      status: "open",
      stage: needs ? "NEEDS HAYDEN" : "ASSIGNED",
      priority: null,
      haydenRequired: needs,
      haydenAction: needs ? "Make a decision" : null,
      blockedReason: null,
      waitingOn: needs ? "Hayden" : row.owner_name,
      nextAction: needs ? "Hayden decides." : `${row.owner_name ?? "The owner"} decides.`,
      dueDate: row.deadline,
      createdAt: String(row.created_at),
      updatedAt: String(row.created_at),
      completedAt: null,
      outcome: null,
      href: "/decisions",
    });
  });
}

function concepts(db: Database.Database): WorkItem[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.objective, c.status, c.brand, c.organisation_id, c.created_at, o.name AS org_name
       FROM creative_concepts c
       LEFT JOIN organisations o ON o.id = c.organisation_id
       WHERE c.status IN ('shortlisted', 'needs_review')
         AND NOT EXISTS (SELECT 1 FROM production_packs p WHERE p.creative_concept_id = c.id)`,
    )
    .all() as Array<Record<string, string | null>>;
  return rows.map((row) =>
    item({
      id: `concept:${row.id}`,
      sourceType: "concept",
      sourceId: String(row.id),
      organisation: row.org_name ?? row.brand,
      organisationId: row.organisation_id,
      project: null,
      projectId: null,
      title: String(row.title),
      objective: row.objective,
      ownerType: "ai",
      ownerId: "creative",
      ownerName: "Creative Director",
      status: String(row.status),
      stage: "NEEDS HAYDEN",
      priority: null,
      haydenRequired: true,
      haydenAction: "Approve concept",
      blockedReason: null,
      waitingOn: "Hayden",
      nextAction: "Approve, request changes, or reject on Command.",
      dueDate: null,
      createdAt: String(row.created_at),
      updatedAt: String(row.created_at),
      completedAt: null,
      outcome: null,
      href: "/",
    }),
  );
}

function jobs(db: Database.Database): WorkItem[] {
  const rows = db
    .prepare(
      `SELECT j.id, j.title, j.objective, j.status, j.agent_id, j.organisation_id, j.project_id, j.created_at, j.started_at,
              o.name AS org_name, pr.name AS project_name, a.name AS agent_name
       FROM agent_jobs j
       LEFT JOIN organisations o ON o.id = j.organisation_id
       LEFT JOIN projects pr ON pr.id = j.project_id
       LEFT JOIN agents a ON a.id = j.agent_id
       WHERE j.status IN ('queued', 'running', 'working')`,
    )
    .all() as Array<Record<string, string | null>>;
  return rows.map((row) =>
    item({
      id: `agent_job:${row.id}`,
      sourceType: "agent_job",
      sourceId: String(row.id),
      organisation: row.org_name,
      organisationId: row.organisation_id,
      project: row.project_name,
      projectId: row.project_id,
      title: String(row.title),
      objective: row.objective,
      ownerType: "ai",
      ownerId: row.agent_id,
      ownerName: row.agent_name,
      status: String(row.status),
      stage: "AI WORKING",
      priority: null,
      haydenRequired: false,
      haydenAction: null,
      blockedReason: null,
      waitingOn: null,
      nextAction: "The agent finishes and comes back only if you are needed.",
      dueDate: null,
      createdAt: String(row.created_at),
      updatedAt: row.started_at ?? String(row.created_at),
      completedAt: null,
      outcome: null,
      href: "/agents",
    }),
  );
}

export function staleWork(items: WorkItem[]) {
  const now = Date.now();
  return items.filter((row) => {
    if (row.sourceType !== "production_pack") return false;
    if (row.stage === "COMPLETE" || row.stage === "CANCELLED") return false;
    const days = (now - new Date(row.updatedAt).getTime()) / 86400000;
    if (Number.isNaN(days)) return false;
    if (row.stage === "ASSIGNED") return days >= STALE_DAYS.assigned;
    if (row.stage === "IN PROGRESS" || row.stage === "CHANGES REQUESTED") return days >= STALE_DAYS.inProgress;
    if (row.stage === "BLOCKED") return days >= STALE_DAYS.blocked;
    if (row.stage === "READY FOR REVIEW") return days >= STALE_DAYS.review;
    return false;
  });
}

export function staleLabel(row: WorkItem) {
  if (row.dueDate && new Date(row.dueDate).getTime() < Date.now()) return `${row.title} is past its stored due date.`;
  if (row.stage === "ASSIGNED") return `${row.title} was assigned and has not been started.`;
  if (row.stage === "READY FOR REVIEW") return `${row.title} is waiting for review and has not moved.`;
  if (row.stage === "BLOCKED") return `${row.title} has stayed blocked.`;
  return `${row.title} has not moved.`;
}

export function projectStageCounts(db: Database.Database, projectId: string) {
  const packs = db
    .prepare(
      `SELECT p.id, p.status, p.creative_concept_id
       FROM production_packs p
       WHERE p.project_id = ?
         AND NOT EXISTS (SELECT 1 FROM production_packs newer WHERE newer.supersedes_id = p.id)`,
    )
    .all(projectId) as Array<{ id: string; status: string; creative_concept_id: string | null }>;
  if (packs.length === 0) return null;
  const work = listWork(db).filter((row) => row.projectId === projectId && row.sourceType === "production_pack");
  const conceptIds = new Set(packs.map((row) => row.creative_concept_id).filter(Boolean));
  let approved = 0;
  if (conceptIds.size) {
    const concepts = db
      .prepare(`SELECT id, status FROM creative_concepts WHERE id IN (${[...conceptIds].map(() => "?").join(",")})`)
      .all(...conceptIds) as Array<{ status: string }>;
    approved = concepts.filter((row) => row.status === "approved").length;
  }
  const count = (stage: WorkStage) => work.filter((row) => row.stage === stage).length;
  const inExecution = count("ASSIGNED") + count("IN PROGRESS") + count("CHANGES REQUESTED") + count("BLOCKED");
  return [
    `${conceptIds.size} concepts`,
    `${approved} approved`,
    `${packs.length} production packs`,
    `${inExecution} in execution`,
    `${count("READY FOR REVIEW")} ready for review`,
    `${count("COMPLETE")} complete`,
    "0 published",
  ].join(" · ");
}

function stringOrNull(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}
