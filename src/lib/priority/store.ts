import type Database from "better-sqlite3";
import { classifyCapture, mentionedPersonId } from "../capture";
import { classifyAttention, ignoreWindowFor, type AttentionClass, type Factors, type Situation } from "./engine";

export type AttentionEntity = "task" | "decision";

export type AttentionItem = {
  id: string;
  entityType: AttentionEntity;
  title: string;
  organisationId: string | null;
  organisationName: string | null;
  why: string | null;
  recommendedAction: string | null;
  estimatedMinutes: number | null;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  status: string;
  score: number;
  classification: AttentionClass;
  reasoning: string;
  dataStatus: string;
  expectedOutcome: string | null;
};

export type TodayBoard = {
  attention: AttentionItem[];
  delegated: AttentionItem[];
  watching: AttentionItem[];
  completed: Array<{ id: string; entityType: AttentionEntity; title: string; organisationName: string | null; completedAt: string }>;
  inbox: Array<{ id: string; rawText: string; kind: string; createdAt: string; dataStatus: string }>;
};

type TaskRow = {
  id: string;
  title: string;
  organisation_id: string | null;
  organisation_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  status: string;
  due_date: string | null;
  requires_hayden: number;
  estimated_minutes: number | null;
  why_it_matters: string | null;
  recommended_action: string | null;
  expected_outcome: string | null;
  data_status: string | null;
  financial_impact: number;
  urgency: number;
  strategic_importance: number;
  hayden_dependency: number;
  risk: number;
  time_cost: number;
};

type DecisionRow = {
  id: string;
  title: string;
  organisation_id: string | null;
  organisation_name: string | null;
  decision_owner_id: string | null;
  owner_name: string | null;
  status: string;
  deadline: string | null;
  context: string | null;
  recommended_option: string | null;
  evidence: string | null;
  cost_of_delay: string | null;
  data_status: string | null;
  financial_impact: number;
  urgency: number;
  strategic_importance: number;
  hayden_dependency: number;
  risk: number;
  time_cost: number;
};

function factorsFrom(row: {
  financial_impact: number;
  urgency: number;
  strategic_importance: number;
  hayden_dependency: number;
  risk: number;
  time_cost: number;
}): Factors {
  return {
    financialImpact: row.financial_impact ?? 0,
    urgency: row.urgency ?? 0,
    strategicImportance: row.strategic_importance ?? 0,
    haydenDependency: row.hayden_dependency ?? 0,
    risk: row.risk ?? 0,
    timeCost: row.time_cost ?? 0,
  };
}

function activeDelegation(db: Database.Database, entityType: AttentionEntity, id: string) {
  return db
    .prepare(
      `SELECT assignee_type, assignee_id, deadline, expected_outcome
       FROM delegations WHERE entity_type = ? AND entity_id = ? AND active = 1
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(entityType, id) as
    | { assignee_type: string; assignee_id: string; deadline: string | null; expected_outcome: string | null }
    | undefined;
}

function latestOverride(db: Database.Database, entityType: AttentionEntity, id: string) {
  return db
    .prepare(
      `SELECT manual_override, classification, override_reason
       FROM priority_assessments
       WHERE entity_type = ? AND entity_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(entityType, id) as
    | { manual_override: number; classification: AttentionClass | null; override_reason: string | null }
    | undefined;
}

function situationForTask(db: Database.Database, task: TaskRow, today: string): Situation {
  const factors = factorsFrom(task);
  const delegation = activeDelegation(db, "task", task.id);
  const delegated = Boolean(delegation) || task.status === "delegated";
  const ownerIsHayden = task.owner_id === "hayden";
  const override = latestOverride(db, "task", task.id);
  return {
    factors,
    needsHaydenDecision: false,
    humanCanHandle: Boolean(task.owner_id) && !ownerIsHayden,
    agentCouldHandle: factors.haydenDependency <= 1,
    alreadyHandled: Boolean(task.owner_id) && !ownerIsHayden && !["done", "dismissed"].includes(task.status),
    delegated,
    deferred: false,
    overdue: task.due_date != null && task.due_date < today && !["done", "dismissed"].includes(task.status),
    blocked: task.status === "blocked",
    highRisk: factors.risk >= 4,
    haydenAuthority: task.requires_hayden === 1 || ownerIsHayden,
    ignore24h: ignoreWindowFor(factors, false),
    manualClassification: override?.manual_override === 1 ? override.classification : null,
    overrideReason: override?.manual_override === 1 ? override.override_reason : null,
  };
}

function situationForDecision(db: Database.Database, decision: DecisionRow, today: string): Situation {
  const factors = factorsFrom(decision);
  const delegation = activeDelegation(db, "decision", decision.id);
  const ownerIsHayden = !decision.decision_owner_id || decision.decision_owner_id === "hayden";
  const deferred = decision.status === "deferred";
  const needsHaydenDecision = decision.status === "open" && ownerIsHayden && !delegation;
  const override = latestOverride(db, "decision", decision.id);
  return {
    factors,
    needsHaydenDecision,
    humanCanHandle: Boolean(decision.decision_owner_id) && !ownerIsHayden,
    agentCouldHandle: false,
    alreadyHandled: Boolean(decision.decision_owner_id) && !ownerIsHayden,
    delegated: Boolean(delegation),
    deferred,
    overdue: decision.deadline != null && decision.deadline < today && (decision.status === "open" || deferred),
    blocked: false,
    highRisk: factors.risk >= 4,
    haydenAuthority: ownerIsHayden && !deferred,
    ignore24h: deferred ? "nothing" : ignoreWindowFor(factors, needsHaydenDecision),
    manualClassification: override?.manual_override === 1 ? override.classification : null,
    overrideReason: override?.manual_override === 1 ? override.override_reason : null,
  };
}

function saveAssessment(
  db: Database.Database,
  entityType: AttentionEntity,
  id: string,
  result: ReturnType<typeof classifyAttention>,
) {
  const previous = db
    .prepare(
      `SELECT manual_override, classification, score
       FROM priority_assessments
       WHERE entity_type = ? AND entity_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(entityType, id) as { manual_override: number; classification: string | null; score: number } | undefined;
  if (previous?.manual_override === 1) return;
  if (previous && previous.classification === result.classification && previous.score === result.score) return;
  db.prepare(
    `INSERT INTO priority_assessments (
      id, entity_type, entity_id, financial_impact, urgency, strategic_importance, hayden_dependency, risk, time_cost,
      score, override_reason, created_at, reasoning, source, manual_override, classification, classification_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'priority-engine', 0, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    entityType,
    id,
    result.factors.financialImpact,
    result.factors.urgency,
    result.factors.strategicImportance,
    result.factors.haydenDependency,
    result.factors.risk,
    result.factors.timeCost,
    result.score,
    new Date().toISOString(),
    result.reasoning,
    result.classification,
    result.reasoning,
  );
}

const TASK_SQL = `
  SELECT t.*, o.name AS organisation_name, p.name AS owner_name
  FROM tasks t
  LEFT JOIN organisations o ON o.id = t.organisation_id
  LEFT JOIN people p ON p.id = t.owner_id
`;

const DECISION_SQL = `
  SELECT d.*, o.name AS organisation_name, p.name AS owner_name
  FROM decisions d
  LEFT JOIN organisations o ON o.id = d.organisation_id
  LEFT JOIN people p ON p.id = d.decision_owner_id
`;

function itemFromTask(task: TaskRow, result: ReturnType<typeof classifyAttention>, outcome: string | null): AttentionItem {
  return {
    id: task.id,
    entityType: "task",
    title: task.title,
    organisationId: task.organisation_id,
    organisationName: task.organisation_name,
    why: task.why_it_matters,
    recommendedAction: task.recommended_action,
    estimatedMinutes: task.estimated_minutes,
    ownerId: task.owner_id,
    ownerName: task.owner_name,
    dueDate: task.due_date,
    status: task.status,
    score: result.score,
    classification: result.classification,
    reasoning: result.reasoning,
    dataStatus: task.data_status ?? "manual",
    expectedOutcome: outcome ?? task.expected_outcome,
  };
}

function itemFromDecision(decision: DecisionRow, result: ReturnType<typeof classifyAttention>, outcome: string | null): AttentionItem {
  return {
    id: decision.id,
    entityType: "decision",
    title: decision.title,
    organisationId: decision.organisation_id,
    organisationName: decision.organisation_name,
    why: decision.context,
    recommendedAction: decision.recommended_option,
    estimatedMinutes: null,
    ownerId: decision.decision_owner_id,
    ownerName: decision.owner_name,
    dueDate: decision.deadline,
    status: decision.status,
    score: result.score,
    classification: result.classification,
    reasoning: result.reasoning,
    dataStatus: decision.data_status ?? "manual",
    expectedOutcome: outcome ?? decision.cost_of_delay,
  };
}

export function assessOpenWork(db: Database.Database, today: string) {
  const tasks = db.prepare(`${TASK_SQL} WHERE t.status NOT IN ('done', 'dismissed')`).all() as TaskRow[];
  const decisions = db
    .prepare(`${DECISION_SQL} WHERE d.status IN ('open', 'deferred')`)
    .all() as DecisionRow[];
  const write = db.transaction(() => {
    for (const task of tasks) saveAssessment(db, "task", task.id, classifyAttention(situationForTask(db, task, today)));
    for (const decision of decisions) {
      saveAssessment(db, "decision", decision.id, classifyAttention(situationForDecision(db, decision, today)));
    }
  });
  write();
}

function sortAttention(items: AttentionItem[]) {
  return items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export function todayBoard(db: Database.Database, today: string): TodayBoard {
  assessOpenWork(db, today);
  const tasks = db.prepare(`${TASK_SQL} WHERE t.status NOT IN ('done', 'dismissed')`).all() as TaskRow[];
  const decisions = db.prepare(`${DECISION_SQL} WHERE d.status IN ('open', 'deferred')`).all() as DecisionRow[];
  const open: AttentionItem[] = [];

  for (const task of tasks) {
    const result = classifyAttention(situationForTask(db, task, today));
    const delegation = activeDelegation(db, "task", task.id);
    open.push(itemFromTask(task, result, delegation?.expected_outcome ?? null));
  }
  for (const decision of decisions) {
    const result = classifyAttention(situationForDecision(db, decision, today));
    const delegation = activeDelegation(db, "decision", decision.id);
    open.push(itemFromDecision(decision, result, delegation?.expected_outcome ?? null));
  }

  const completedTasks = db
    .prepare(
      `SELECT t.id, t.title, t.completed_at, o.name AS organisation_name
       FROM tasks t LEFT JOIN organisations o ON o.id = t.organisation_id
       WHERE t.status = 'done' AND t.completed_at IS NOT NULL`,
    )
    .all() as Array<{ id: string; title: string; completed_at: string; organisation_name: string | null }>;
  const completedDecisions = db
    .prepare(
      `SELECT d.id, d.title, d.decided_at, o.name AS organisation_name
       FROM decisions d LEFT JOIN organisations o ON o.id = d.organisation_id
       WHERE d.status = 'decided' AND d.decided_at IS NOT NULL`,
    )
    .all() as Array<{ id: string; title: string; decided_at: string; organisation_name: string | null }>;

  const completed = [
    ...completedTasks
      .filter((row) => brisbaneDate(row.completed_at) === today)
      .map((row) => ({
        id: row.id,
        entityType: "task" as const,
        title: row.title,
        organisationName: row.organisation_name,
        completedAt: row.completed_at,
      })),
    ...completedDecisions
      .filter((row) => brisbaneDate(row.decided_at) === today)
      .map((row) => ({
        id: row.id,
        entityType: "decision" as const,
        title: row.title,
        organisationName: row.organisation_name,
        completedAt: row.decided_at,
      })),
  ];

  const inbox = db
    .prepare(`SELECT id, raw_text AS rawText, kind, created_at AS createdAt, data_status AS dataStatus FROM captures ORDER BY created_at DESC LIMIT 20`)
    .all() as TodayBoard["inbox"];

  return {
    attention: sortAttention(open.filter((item) => item.classification === "hayden_now")),
    delegated: sortAttention(open.filter((item) => item.classification === "delegate")),
    watching: sortAttention(open.filter((item) => item.classification === "hayden_soon" || item.classification === "monitor")),
    completed,
    inbox,
  };
}

function brisbaneDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function writeAudit(
  db: Database.Database,
  entry: {
    evidence: string | null;
    reasoning: string | null;
    recommendation: string | null;
    actionsTaken: string;
    entityType: string;
    entityId: string;
  },
) {
  db.prepare(
    `INSERT INTO audit_log (id, agent, created_at, evidence, reasoning, recommendation, confidence, actions_taken, entity_type, entity_id)
     VALUES (?, 'command-centre', ?, ?, ?, ?, 'high', ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    new Date().toISOString(),
    entry.evidence,
    entry.reasoning,
    entry.recommendation,
    entry.actionsTaken,
    entry.entityType,
    entry.entityId,
  );
}

export function delegateWork(
  db: Database.Database,
  input: {
    entityType: AttentionEntity;
    entityId: string;
    assigneeType: "person" | "agent";
    assigneeId: string;
    deadline: string;
    expectedOutcome: string;
  },
) {
  if (!input.deadline || !input.expectedOutcome.trim()) {
    throw new Error("Delegation needs a deadline and an expected outcome.");
  }
  if (input.assigneeType === "person" && input.assigneeId === "hayden") {
    throw new Error("Delegation has to leave Hayden.");
  }

  const now = new Date().toISOString();
  const apply = db.transaction(() => {
    db.prepare(`UPDATE delegations SET active = 0 WHERE entity_type = ? AND entity_id = ? AND active = 1`).run(
      input.entityType,
      input.entityId,
    );
    db.prepare(
      `INSERT INTO delegations (id, entity_type, entity_id, assignee_type, assignee_id, deadline, expected_outcome, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      crypto.randomUUID(),
      input.entityType,
      input.entityId,
      input.assigneeType,
      input.assigneeId,
      input.deadline,
      input.expectedOutcome.trim(),
      now,
    );

    if (input.entityType === "task") {
      const ownerId = input.assigneeType === "person" ? input.assigneeId : null;
      db.prepare(
        `UPDATE tasks
         SET status = 'delegated', owner_id = COALESCE(?, owner_id), due_date = ?, expected_outcome = ?, requires_hayden = 0
         WHERE id = ?`,
      ).run(ownerId, input.deadline, input.expectedOutcome.trim(), input.entityId);
    } else {
      const ownerId = input.assigneeType === "person" ? input.assigneeId : null;
      db.prepare(
        `UPDATE decisions
         SET decision_owner_id = COALESCE(?, decision_owner_id), deadline = ?
         WHERE id = ? AND status = 'open'`,
      ).run(ownerId, input.deadline, input.entityId);
    }

    writeAudit(db, {
      evidence: input.expectedOutcome.trim(),
      reasoning: "Hayden delegated this from the command centre.",
      recommendation: null,
      actionsTaken: `delegated to ${input.assigneeType}:${input.assigneeId}; deadline ${input.deadline}`,
      entityType: input.entityType,
      entityId: input.entityId,
    });
  });
  apply();
}

export function setTaskStatus(db: Database.Database, id: string, status: "done" | "dismissed") {
  const task = db.prepare(`SELECT title, recommended_action FROM tasks WHERE id = ?`).get(id) as
    | { title: string; recommended_action: string | null }
    | undefined;
  if (!task) throw new Error("That task is not in memory.");
  const completedAt = status === "done" ? new Date().toISOString() : null;
  db.prepare(`UPDATE tasks SET status = ?, requires_hayden = 0, completed_at = ? WHERE id = ?`).run(status, completedAt, id);
  writeAudit(db, {
    evidence: task.title,
    reasoning: `Hayden set this to ${status}.`,
    recommendation: task.recommended_action,
    actionsTaken: `status=${status}`,
    entityType: "task",
    entityId: id,
  });
}

export function deferDecision(db: Database.Database, id: string, deadline: string) {
  const decision = db.prepare(`SELECT title FROM decisions WHERE id = ? AND status = 'open'`).get(id) as { title: string } | undefined;
  if (!decision) throw new Error("That decision is not open.");
  db.prepare(`UPDATE decisions SET status = 'deferred', deadline = ? WHERE id = ?`).run(deadline, id);
  writeAudit(db, {
    evidence: decision.title,
    reasoning: "Hayden deferred the decision. It leaves this morning's list.",
    recommendation: null,
    actionsTaken: `deferred until ${deadline}`,
    entityType: "decision",
    entityId: id,
  });
}

export function recordDecisionChoice(db: Database.Database, id: string, choice: string) {
  const decision = db.prepare(`SELECT title, context, options, recommended_option, status FROM decisions WHERE id = ?`).get(id) as
    | { title: string; context: string | null; options: string | null; recommended_option: string | null; status: string }
    | undefined;
  if (!decision || decision.status !== "open") throw new Error("That decision is not open.");
  const options = JSON.parse(decision.options ?? "[]") as unknown;
  const allowed = Array.isArray(options) ? options.filter((item): item is string => typeof item === "string") : [];
  if (!allowed.includes(choice)) throw new Error("That option is not on the decision.");
  db.prepare(`UPDATE decisions SET decision = ?, status = 'decided', decided_at = ? WHERE id = ?`).run(choice, new Date().toISOString(), id);
  writeAudit(db, {
    evidence: decision.context,
    reasoning: "Hayden recorded the decision.",
    recommendation: decision.recommended_option,
    actionsTaken: `decided: ${choice}`,
    entityType: "decision",
    entityId: id,
  });
}

export function captureText(db: Database.Database, rawText: string) {
  const text = rawText.trim();
  if (!text) throw new Error("Write something before capturing it.");
  const kind = classifyCapture(text);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let linkedType: string | null = null;
  let linkedId: string | null = null;

  const apply = db.transaction(() => {
    if (kind === "task") {
      const people = db.prepare(`SELECT id, name FROM people WHERE status = 'active'`).all() as Array<{ id: string; name: string }>;
      const personId = mentionedPersonId(text, people);
      const person = people.find((item) => item.id === personId);
      if (person && person.id !== "hayden") {
        linkedType = "task";
        linkedId = crypto.randomUUID();
        const organisationId = db.prepare(`SELECT organisation_id FROM people WHERE id = ?`).get(person.id) as {
          organisation_id: string | null;
        };
        db.prepare(
          `INSERT INTO tasks (
            id, project_id, organisation_id, title, description, owner_id, priority, status, due_date, requires_hayden,
            estimated_minutes, expected_impact, recommended_action, why_it_matters, source, created_at, completed_at,
            data_status, source_type, source_name, source_record, last_updated,
            financial_impact, urgency, strategic_importance, hayden_dependency, risk, time_cost, expected_outcome
          ) VALUES (
            ?, NULL, ?, ?, ?, ?, 'low', 'open', NULL, 0,
            NULL, NULL, ?, ?, 'capture', ?, NULL,
            'manual', 'hayden', 'Hayden', ?, ?,
            0, 1, 1, 0, 0, 1, NULL
          )`,
        ).run(
          linkedId,
          organisationId?.organisation_id ?? null,
          text.slice(0, 180),
          text,
          person.id,
          "Leave this with the named person.",
          "Captured from the command bar. It is not a Hayden priority.",
          now,
          id,
          now,
        );
      }
    }

    db.prepare(
      `INSERT INTO captures (id, raw_text, kind, data_status, source_type, source_name, created_at, linked_entity_type, linked_entity_id)
       VALUES (?, ?, ?, 'manual', 'hayden', 'Hayden', ?, ?, ?)`,
    ).run(id, text, kind, now, linkedType, linkedId);

    writeAudit(db, {
      evidence: text,
      reasoning: `Classified as ${kind} by the capture rules. It was not placed on Hayden's morning list.`,
      recommendation: null,
      actionsTaken: `captured as ${kind}`,
      entityType: "capture",
      entityId: id,
    });
  });
  apply();
  return { id, kind };
}

export type NewWork = {
  id?: string;
  organisationId: string | null;
  title: string;
  ownerId: string | null;
  dataStatus?: string;
  dueDate?: string | null;
  why?: string | null;
  recommendedAction?: string | null;
  estimatedMinutes?: number | null;
  factors: Factors;
  requiresHayden?: boolean;
  status?: string;
  context?: string | null;
  options?: string[];
  recommendedOption?: string | null;
  evidence?: string | null;
  costOfDelay?: string | null;
};

export function insertTask(db: Database.Database, work: NewWork) {
  const id = work.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (
      id, organisation_id, title, description, owner_id, priority, status, due_date, requires_hayden,
      estimated_minutes, recommended_action, why_it_matters, source, created_at,
      data_status, source_type, source_name, last_updated,
      financial_impact, urgency, strategic_importance, hayden_dependency, risk, time_cost
    ) VALUES (?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?, ?, ?, 'manual', ?, ?, 'manual', 'Hayden', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    work.organisationId,
    work.title,
    work.why ?? null,
    work.ownerId,
    work.status ?? "open",
    work.dueDate ?? null,
    work.requiresHayden ? 1 : 0,
    work.estimatedMinutes ?? null,
    work.recommendedAction ?? null,
    work.why ?? null,
    now,
    work.dataStatus ?? "manual",
    now,
    work.factors.financialImpact,
    work.factors.urgency,
    work.factors.strategicImportance,
    work.factors.haydenDependency,
    work.factors.risk,
    work.factors.timeCost,
  );
  writeAudit(db, {
    evidence: work.title,
    reasoning: "Created in the operating memory.",
    recommendation: work.recommendedAction ?? null,
    actionsTaken: "created task",
    entityType: "task",
    entityId: id,
  });
  return id;
}

export function insertDecision(db: Database.Database, work: NewWork) {
  const id = work.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO decisions (
      id, organisation_id, title, context, options, recommended_option, decision, decision_owner_id, status, deadline,
      created_at, decided_at, data_status, source_type, source_name, last_updated, evidence, cost_of_delay,
      financial_impact, urgency, strategic_importance, hayden_dependency, risk, time_cost
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'open', ?, ?, NULL, ?, 'manual', 'Hayden', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    work.organisationId,
    work.title,
    work.context ?? work.why ?? null,
    JSON.stringify(work.options ?? []),
    work.recommendedOption ?? work.recommendedAction ?? null,
    work.ownerId ?? "hayden",
    work.dueDate ?? null,
    now,
    work.dataStatus ?? "manual",
    now,
    work.evidence ?? null,
    work.costOfDelay ?? null,
    work.factors.financialImpact,
    work.factors.urgency,
    work.factors.strategicImportance,
    work.factors.haydenDependency,
    work.factors.risk,
    work.factors.timeCost,
  );
  writeAudit(db, {
    evidence: work.title,
    reasoning: "Created as a decision. It is not an ordinary task.",
    recommendation: work.recommendedOption ?? work.recommendedAction ?? null,
    actionsTaken: "created decision",
    entityType: "decision",
    entityId: id,
  });
  return id;
}
