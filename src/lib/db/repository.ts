import "server-only";

import { getDb } from "@/lib/db/client";
import { brisbaneToday } from "@/lib/dates";
import { todayBoard } from "@/lib/priority/store";
import { log } from "@/lib/log";
import type {
  Agent,
  AgentPermission,
  Campaign,
  CampaignMetric,
  ContentItem,
  Decision,
  Experiment,
  Finding,
  Integration,
  Issue,
  Knowledge,
  Metric,
  OpenQuestion,
  Opportunity,
  OpportunityFactor,
  Organisation,
  Person,
  Project,
  PulseCard,
  Task,
  TeamMember,
} from "@/lib/db/types";

const OPEN_TASK = `('open', 'in_progress', 'waiting', 'blocked')`;

const TASK_FROM = `
  FROM tasks t
  LEFT JOIN organisations o ON o.id = t.organisation_id
  LEFT JOIN people p ON p.id = t.owner_id
  LEFT JOIN projects pr ON pr.id = t.project_id
`;

function db() {
  return getDb();
}

function parseOptions(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch (error) {
    log.warn("decision options were not valid json", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

type DecisionRow = Omit<Decision, "options"> & { options: string | null };

function mapDecision(row: DecisionRow): Decision {
  return { ...row, options: parseOptions(row.options) };
}

export function listOrganisations(): Organisation[] {
  return db().prepare("SELECT * FROM organisations WHERE status = 'active' ORDER BY sort_order").all() as Organisation[];
}

export function getOrganisation(id: string): Organisation | undefined {
  return db().prepare("SELECT * FROM organisations WHERE id = ?").get(id) as Organisation | undefined;
}

export function listPeople(): Person[] {
  return db().prepare("SELECT * FROM people WHERE status = 'active' ORDER BY name").all() as Person[];
}

export function listProjects(): Project[] {
  return db()
    .prepare(
      `SELECT pr.*, o.name AS organisation_name, p.name AS owner_name
       FROM projects pr
       LEFT JOIN organisations o ON o.id = pr.organisation_id
       LEFT JOIN people p ON p.id = pr.owner_id
       WHERE pr.status != 'cancelled'
       ORDER BY pr.due_date IS NULL, pr.due_date`,
    )
    .all() as Project[];
}

export function listHaydenPriorities(limit = 5): Task[] {
  return db()
    .prepare(
      `SELECT t.*, o.name AS organisation_name, p.name AS owner_name, pr.name AS project_name
       ${TASK_FROM}
       WHERE t.requires_hayden = 1 AND t.status IN ('open', 'in_progress')
       ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                t.due_date
       LIMIT ?`,
    )
    .all(limit) as Task[];
}

export function countSuppressedTasks(): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE requires_hayden = 0 AND status IN ${OPEN_TASK}`)
    .get() as { n: number };
  return row.n;
}

export function getTask(id: string): Task | undefined {
  return db()
    .prepare(
      `SELECT t.*, o.name AS organisation_name, p.name AS owner_name, pr.name AS project_name
       ${TASK_FROM}
       WHERE t.id = ?`,
    )
    .get(id) as Task | undefined;
}

export function listTasksForPerson(personId: string): Task[] {
  return db()
    .prepare(
      `SELECT t.*, o.name AS organisation_name, p.name AS owner_name, pr.name AS project_name
       ${TASK_FROM}
       WHERE t.owner_id = ?
       ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END, t.due_date`,
    )
    .all(personId) as Task[];
}

export function listDecisions(status?: string): Decision[] {
  const sql = status
    ? `SELECT d.*, o.name AS organisation_name, p.name AS owner_name
       FROM decisions d
       LEFT JOIN organisations o ON o.id = d.organisation_id
       LEFT JOIN people p ON p.id = d.decision_owner_id
       WHERE d.status = ?
       ORDER BY d.deadline`
    : `SELECT d.*, o.name AS organisation_name, p.name AS owner_name
       FROM decisions d
       LEFT JOIN organisations o ON o.id = d.organisation_id
       LEFT JOIN people p ON p.id = d.decision_owner_id
       ORDER BY CASE d.status WHEN 'open' THEN 0 ELSE 1 END, d.deadline`;
  const rows = (status ? db().prepare(sql).all(status) : db().prepare(sql).all()) as DecisionRow[];
  return rows.map(mapDecision);
}

export function getDecision(id: string): Decision | undefined {
  const row = db()
    .prepare(
      `SELECT d.*, o.name AS organisation_name, p.name AS owner_name
       FROM decisions d
       LEFT JOIN organisations o ON o.id = d.organisation_id
       LEFT JOIN people p ON p.id = d.decision_owner_id
       WHERE d.id = ?`,
    )
    .get(id) as DecisionRow | undefined;
  return row ? mapDecision(row) : undefined;
}

export function listFindings(): Finding[] {
  return db()
    .prepare(
      `SELECT f.*, o.name AS organisation_name
       FROM findings f
       LEFT JOIN organisations o ON o.id = f.organisation_id
       ORDER BY f.requires_hayden DESC, f.created_at DESC`,
    )
    .all() as Finding[];
}

export function listPulse(): PulseCard[] {
  const organisations = listOrganisations();
  const metrics = db()
    .prepare(
      `SELECT * FROM organisation_metrics m
       WHERE metric_date = (
         SELECT MAX(metric_date) FROM organisation_metrics WHERE organisation_id = m.organisation_id
       )
       ORDER BY sort_order`,
    )
    .all() as Metric[];
  return organisations.map((organisation) => ({
    organisation,
    metrics: metrics.filter((metric) => metric.organisation_id === organisation.id),
  }));
}

export function listTeam(): TeamMember[] {
  const today = brisbaneToday(0);
  const people = db()
    .prepare(
      `SELECT p.*, o.name AS organisation_name, m.name AS manager_name,
              (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = p.id AND t.status IN ${OPEN_TASK}) AS open_tasks,
              (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = p.id AND t.status IN ${OPEN_TASK} AND t.due_date IS NOT NULL AND t.due_date < ?) AS overdue_tasks,
              (SELECT COUNT(*) FROM issues i WHERE i.assigned_to = p.id AND i.status != 'resolved') AS open_issues,
              (SELECT MAX(created_at) FROM tasks t WHERE t.owner_id = p.id) AS last_update
       FROM people p
       LEFT JOIN organisations o ON o.id = p.organisation_id
       LEFT JOIN people m ON m.id = p.manager_id
       WHERE p.status = 'active'
       ORDER BY CASE p.id WHEN 'hayden' THEN 0 ELSE 1 END, p.name`,
    )
    .all(today) as Array<Omit<TeamMember, "priorities">>;

  const priorityStatement = db().prepare(
    `SELECT title FROM tasks
     WHERE owner_id = ? AND status IN ${OPEN_TASK}
     ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, due_date
     LIMIT 3`,
  );

  return people.map((person) => ({
    ...person,
    priorities: (priorityStatement.all(person.id) as Array<{ title: string }>).map((row) => row.title),
  }));
}

export function getTeamMember(id: string): TeamMember | undefined {
  return listTeam().find((person) => person.id === id);
}

export function listCampaigns(organisationId?: string): Campaign[] {
  const sql = `SELECT c.*, o.name AS organisation_name
    FROM campaigns c JOIN organisations o ON o.id = c.organisation_id`;
  if (organisationId) {
    return db().prepare(`${sql} WHERE c.organisation_id = ? ORDER BY c.name`).all(organisationId) as Campaign[];
  }
  return db().prepare(`${sql} ORDER BY c.name`).all() as Campaign[];
}

export function listCampaignMetrics(campaignId: string): CampaignMetric[] {
  return db()
    .prepare("SELECT * FROM campaign_metrics WHERE campaign_id = ? ORDER BY date")
    .all(campaignId) as CampaignMetric[];
}

export function listContent(): ContentItem[] {
  return db().prepare("SELECT * FROM content ORDER BY reach DESC").all() as ContentItem[];
}

export function listExperiments(): Experiment[] {
  return db()
    .prepare(
      `SELECT e.*, o.name AS organisation_name
       FROM experiments e LEFT JOIN organisations o ON o.id = e.organisation_id
       ORDER BY e.start_date DESC`,
    )
    .all() as Experiment[];
}

export function listIssues(): Issue[] {
  return db()
    .prepare(
      `SELECT i.*, o.name AS organisation_name, p.name AS assignee_name
       FROM issues i
       LEFT JOIN organisations o ON o.id = i.organisation_id
       LEFT JOIN people p ON p.id = i.assigned_to
       WHERE i.status != 'resolved'
       ORDER BY CASE i.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
    )
    .all() as Issue[];
}

export function listOpportunities(): Opportunity[] {
  return db()
    .prepare(
      `SELECT op.*, o.name AS organisation_name, p.name AS owner_name
       FROM opportunities op
       LEFT JOIN organisations o ON o.id = op.organisation_id
       LEFT JOIN people p ON p.id = op.owner_id
       WHERE op.status = 'open'`,
    )
    .all() as Opportunity[];
}

export function listOpenQuestions(): OpenQuestion[] {
  return db()
    .prepare(
      `SELECT q.*, o.name AS organisation_name
       FROM open_questions q
       LEFT JOIN organisations o ON o.id = q.organisation_id
       ORDER BY CASE q.status WHEN 'open' THEN 0 ELSE 1 END, q.question`,
    )
    .all() as OpenQuestion[];
}

export function listOpportunityFramework(): OpportunityFactor[] {
  return db().prepare(`SELECT * FROM opportunity_framework ORDER BY sort_order`).all() as OpportunityFactor[];
}

export function listStoredMetrics(): Metric[] {
  return db().prepare(`SELECT * FROM organisation_metrics ORDER BY metric_date DESC`).all() as Metric[];
}

export function listKnowledge(): Knowledge[] {
  return db()
    .prepare(
      `SELECT k.*, o.name AS organisation_name
       FROM knowledge k LEFT JOIN organisations o ON o.id = k.organisation_id
       ORDER BY k.title`,
    )
    .all() as Knowledge[];
}

export function searchKnowledge(query: string, limit = 5): Knowledge[] {
  const term = `%${query.trim()}%`;
  if (term === "%%") return [];
  return db()
    .prepare(
      `SELECT k.*, o.name AS organisation_name
       FROM knowledge k LEFT JOIN organisations o ON o.id = k.organisation_id
       WHERE k.title LIKE ? OR k.content LIKE ?
       LIMIT ?`,
    )
    .all(term, term, limit) as Knowledge[];
}

export function listAgents(): Agent[] {
  return db()
    .prepare(
      `SELECT a.*, o.name AS organisation_name
       FROM agents a LEFT JOIN organisations o ON o.id = a.organisation_id
       ORDER BY CASE a.slug WHEN 'chief-of-staff' THEN 0 ELSE 1 END, a.name`,
    )
    .all() as Agent[];
}

export function listAssignees() {
  const people = listPeople()
    .filter((person) => person.id !== "hayden")
    .map((person) => ({ value: `person:${person.id}`, label: person.name }));
  const agents = listAgents().map((agent) => ({ value: `agent:${agent.id}`, label: `${agent.name} · agent` }));
  return [...people, ...agents];
}

export function listPermissions(): AgentPermission[] {
  return db().prepare("SELECT * FROM agent_permissions ORDER BY agent_id, level").all() as AgentPermission[];
}

export function listIntegrations(): Integration[] {
  return db().prepare("SELECT * FROM integrations ORDER BY name").all() as Integration[];
}

export function databaseFile() {
  return process.env.DATABASE_PATH ?? "./data/hayden.db";
}

function safeNext(value: FormDataEntryValue | null) {
  const next = String(value ?? "/");
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

export function updateTaskFromForm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const allowed = ["done", "dismissed", "delegated"];
  if (!id || !allowed.includes(status)) {
    throw new Error("That task update is not valid.");
  }

  const task = getTask(id);
  if (!task) throw new Error("That task is not in memory.");

  const ownerId = status === "delegated" ? String(formData.get("owner_id") ?? "") : task.owner_id;
  if (status === "delegated") {
    const person = listPeople().find((candidate) => candidate.id === ownerId);
    if (!person || person.id === "hayden") throw new Error("Choose someone else to own the delegated task.");
  }

  const completedAt = status === "done" ? new Date().toISOString() : task.completed_at;
  db()
    .prepare(
      `UPDATE tasks
       SET status = ?, owner_id = ?, requires_hayden = 0, completed_at = ?
       WHERE id = ?`,
    )
    .run(status, ownerId, completedAt, id);

  writeAudit({
    agent: "command-centre",
    evidence: task.title,
    reasoning: `Hayden set this to ${status} from the command centre.`,
    recommendation: task.recommended_action,
    confidence: "high",
    actions_taken: `status=${status}${status === "delegated" ? `; owner=${ownerId}` : ""}`,
    entity_type: "task",
    entity_id: id,
  });

  return safeNext(formData.get("next"));
}

export function recordDecisionFromForm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const choice = String(formData.get("choice") ?? "").trim();
  const decision = getDecision(id);
  if (!decision || decision.status !== "open") throw new Error("That decision is not open.");
  if (!choice) throw new Error("Choose an option before recording it.");
  if (!decision.options.includes(choice)) throw new Error("That option is not on the decision.");

  const decidedAt = new Date().toISOString();
  db()
    .prepare(`UPDATE decisions SET decision = ?, status = 'decided', decided_at = ? WHERE id = ?`)
    .run(choice, decidedAt, id);

  writeAudit({
    agent: "command-centre",
    evidence: decision.context,
    reasoning: "Hayden recorded the decision from the queue.",
    recommendation: decision.recommended_option,
    confidence: "high",
    actions_taken: `decided: ${choice}`,
    entity_type: "decision",
    entity_id: id,
  });

  return safeNext(formData.get("next"));
}

export function writeAudit(entry: {
  agent: string;
  evidence: string | null;
  reasoning: string | null;
  recommendation: string | null;
  confidence: string | null;
  actions_taken: string | null;
  entity_type: string;
  entity_id: string;
}) {
  const database = db();
  database
    .prepare(
      `INSERT INTO audit_log
        (id, agent, created_at, evidence, reasoning, recommendation, confidence, actions_taken, entity_type, entity_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      entry.agent,
      new Date().toISOString(),
      entry.evidence,
      entry.reasoning,
      entry.recommendation,
      entry.confidence,
      entry.actions_taken,
      entry.entity_type,
      entry.entity_id,
    );
}

export function memorySnapshot() {
  return {
    priorities: listHaydenPriorities(5),
    attention: loadToday().attention,
    organisations: listOrganisations(),
    people: listTeam(),
    tasks: db()
      .prepare(
        `SELECT t.*, o.name AS organisation_name, p.name AS owner_name, pr.name AS project_name ${TASK_FROM}`,
      )
      .all() as Task[],
    decisions: listDecisions(),
    findings: listFindings(),
    issues: listIssues(),
    knowledge: listKnowledge(),
    openQuestions: listOpenQuestions(),
    metrics: listStoredMetrics(),
    projects: listProjects(),
    content: listContent(),
    experiments: listExperiments(),
    campaigns: listCampaigns(),
  };
}

export type MemorySnapshot = ReturnType<typeof memorySnapshot>;

export function loadToday() {
  return todayBoard(getDb(), brisbaneToday());
}
