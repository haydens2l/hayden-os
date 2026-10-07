import type Database from "better-sqlite3";
import { brisbaneToday } from "@/lib/dates";

export type OrgRow = {
  id: string;
  name: string;
  parent_id: string | null;
  strategic_priority: number | null;
  growth_intent: string | null;
  strategic_role: string | null;
  desired_hayden_involvement: string | null;
  hayden_role: string | null;
  primary_objective: string | null;
};

export type PersonRow = {
  id: string;
  name: string;
  role: string | null;
  responsibilities: string | null;
  notes: string | null;
  organisation_id: string | null;
};

export type WorkRow = {
  id: string;
  organisation_id: string | null;
  organisation_name: string | null;
  title: string;
  description: string | null;
  owner_id: string | null;
  owner_name: string | null;
  status: string;
  due_date: string | null;
  requires_hayden: number;
  estimated_minutes: number | null;
  recommended_action: string | null;
  expected_outcome: string | null;
  created_at: string;
  data_status: string | null;
  financial_impact: number;
  urgency: number;
  strategic_importance: number;
  hayden_dependency: number;
  risk: number;
  time_cost: number;
  delegated: number;
};

export type ProjectRow = {
  id: string;
  organisation_id: string | null;
  organisation_name: string | null;
  name: string;
  description: string | null;
  owner_id: string | null;
  owner_name: string | null;
  status: string;
  blocked_by: string | null;
  hayden_involvement: string | null;
  health: string | null;
  next_action: string | null;
  created_at: string;
  updated_at: string;
  data_status: string | null;
  strategic_priority: number | null;
  growth_intent: string | null;
  strategic_role: string | null;
  desired_hayden_involvement: string | null;
};

export type OpportunityRow = {
  id: string;
  organisation_id: string | null;
  organisation_name: string | null;
  category: string | null;
  title: string;
  description: string | null;
  potential_value: string | null;
  confidence: string | null;
  recommended_action: string | null;
  owner_id: string | null;
  owner_name: string | null;
  status: string;
  created_at: string;
  data_status: string | null;
  strategic_priority: number | null;
  growth_intent: string | null;
  strategic_role: string | null;
  desired_hayden_involvement: string | null;
};

export type IssueRow = {
  id: string;
  organisation_id: string | null;
  organisation_name: string | null;
  category: string | null;
  severity: string | null;
  title: string;
  description: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  requires_hayden: number;
  status: string;
  detected_at: string;
  data_status: string | null;
  strategic_priority: number | null;
  growth_intent: string | null;
  strategic_role: string | null;
  desired_hayden_involvement: string | null;
};

export type MetricRow = {
  id: string;
  organisation_id: string;
  organisation_name: string | null;
  metric_key: string;
  label: string;
  value: string;
  metric_date: string;
  data_status: string | null;
  last_updated: string | null;
};

export type KnowledgeRow = {
  id: string;
  title: string;
  content: string;
  context_type: string | null;
  organisation_id: string | null;
  data_status: string | null;
};

export type ChiefContext = {
  today: string;
  organisations: OrgRow[];
  people: PersonRow[];
  tasks: WorkRow[];
  decisions: WorkRow[];
  projects: ProjectRow[];
  driveLinks: Array<{ project_id: string; label: string; web_url: string | null }>;
  opportunities: OpportunityRow[];
  issues: IssueRow[];
  metrics: MetricRow[];
  knowledge: KnowledgeRow[];
  previousGeneratedAt: string | null;
};

const ORG_FIELDS = `o.strategic_priority, o.growth_intent, o.strategic_role, o.desired_hayden_involvement`;

export function retrieveContext(db: Database.Database): ChiefContext {
  const organisations = db
    .prepare(
      `SELECT id, name, parent_id, strategic_priority, growth_intent, strategic_role,
              desired_hayden_involvement, hayden_role, primary_objective
       FROM organisations
       WHERE status = 'active'`,
    )
    .all() as OrgRow[];

  const people = db
    .prepare(
      `SELECT id, name, role, responsibilities, notes, organisation_id
       FROM people
       WHERE status = 'active'`,
    )
    .all() as PersonRow[];

  const tasks = db
    .prepare(
      `SELECT t.id, t.organisation_id, o.name AS organisation_name, t.title, t.description,
              t.owner_id, p.name AS owner_name, t.status, t.due_date, t.requires_hayden,
              t.estimated_minutes, t.recommended_action, t.expected_outcome, t.created_at, t.data_status,
              t.financial_impact, t.urgency, t.strategic_importance, t.hayden_dependency, t.risk, t.time_cost,
              CASE WHEN t.status = 'delegated' OR EXISTS (
                SELECT 1 FROM delegations d WHERE d.entity_type = 'task' AND d.entity_id = t.id AND d.active = 1
              ) THEN 1 ELSE 0 END AS delegated,
              ${ORG_FIELDS}
       FROM tasks t
       LEFT JOIN organisations o ON o.id = t.organisation_id
       LEFT JOIN people p ON p.id = t.owner_id
       WHERE t.status NOT IN ('done', 'dismissed')
       ORDER BY t.created_at DESC
       LIMIT 80`,
    )
    .all() as WorkRow[];

  const decisions = db
    .prepare(
      `SELECT d.id, d.organisation_id, o.name AS organisation_name, d.title, d.context AS description,
              d.decision_owner_id AS owner_id, p.name AS owner_name, d.status, d.deadline AS due_date,
              CASE WHEN d.decision_owner_id IS NULL OR d.decision_owner_id = 'hayden' THEN 1 ELSE 0 END AS requires_hayden,
              NULL AS estimated_minutes, d.recommended_option AS recommended_action, NULL AS expected_outcome,
              d.created_at, d.data_status,
              d.financial_impact, d.urgency, d.strategic_importance, d.hayden_dependency, d.risk, d.time_cost,
              CASE WHEN EXISTS (
                SELECT 1 FROM delegations g WHERE g.entity_type = 'decision' AND g.entity_id = d.id AND g.active = 1
              ) THEN 1 ELSE 0 END AS delegated,
              ${ORG_FIELDS}
       FROM decisions d
       LEFT JOIN organisations o ON o.id = d.organisation_id
       LEFT JOIN people p ON p.id = d.decision_owner_id
       WHERE d.status IN ('open', 'deferred')
       ORDER BY d.created_at DESC
       LIMIT 40`,
    )
    .all() as WorkRow[];

  const projects = db
    .prepare(
      `SELECT pr.id, pr.organisation_id, o.name AS organisation_name, pr.name, pr.description,
              pr.owner_id, p.name AS owner_name, pr.status, pr.blocked_by, pr.hayden_involvement, pr.health,
              pr.next_action, pr.created_at, pr.updated_at, pr.data_status, ${ORG_FIELDS}
       FROM projects pr
       LEFT JOIN organisations o ON o.id = pr.organisation_id
       LEFT JOIN people p ON p.id = pr.owner_id
       WHERE pr.status NOT IN ('completed', 'cancelled')
       ORDER BY pr.updated_at DESC
       LIMIT 40`,
    )
    .all() as ProjectRow[];

  const opportunities = db
    .prepare(
      `SELECT op.id, op.organisation_id, o.name AS organisation_name, op.category, op.title, op.description,
              op.potential_value, op.confidence, op.recommended_action, op.owner_id, p.name AS owner_name,
              op.status, op.created_at, op.data_status, ${ORG_FIELDS}
       FROM opportunities op
       LEFT JOIN organisations o ON o.id = op.organisation_id
       LEFT JOIN people p ON p.id = op.owner_id
       WHERE op.status NOT IN ('closed', 'dismissed', 'done', 'cancelled')
       ORDER BY op.created_at DESC
       LIMIT 20`,
    )
    .all() as OpportunityRow[];

  const issues = db
    .prepare(
      `SELECT i.id, i.organisation_id, o.name AS organisation_name, i.category, i.severity, i.title, i.description,
              i.assigned_to, p.name AS assignee_name, i.requires_hayden, i.status, i.detected_at, i.data_status,
              ${ORG_FIELDS}
       FROM issues i
       LEFT JOIN organisations o ON o.id = i.organisation_id
       LEFT JOIN people p ON p.id = i.assigned_to
       WHERE i.status != 'resolved'
       ORDER BY i.detected_at DESC
       LIMIT 30`,
    )
    .all() as IssueRow[];

  const metrics = db
    .prepare(
      `SELECT m.id, m.organisation_id, o.name AS organisation_name, m.metric_key, m.label, m.value,
              m.metric_date, m.data_status, m.last_updated
       FROM organisation_metrics m
       LEFT JOIN organisations o ON o.id = m.organisation_id
       ORDER BY m.metric_date DESC
       LIMIT 40`,
    )
    .all() as MetricRow[];

  const knowledge = db
    .prepare(
      `SELECT id, title, content, context_type, organisation_id, data_status
       FROM knowledge
       WHERE superseded_by_id IS NULL
         AND (context_type IS NULL OR context_type != 'HISTORICAL')
       ORDER BY CASE context_type
         WHEN 'STRATEGY' THEN 0
         WHEN 'PREFERENCE' THEN 1
         WHEN 'DECISION' THEN 2
         ELSE 3
       END, updated_at DESC
       LIMIT 20`,
    )
    .all() as KnowledgeRow[];

  const driveLinks = db
    .prepare(`SELECT project_id, label, web_url FROM project_drive_links`)
    .all() as ChiefContext["driveLinks"];

  const previous = db.prepare(`SELECT generated_at FROM briefs ORDER BY generated_at DESC LIMIT 1`).get() as
    | { generated_at: string }
    | undefined;

  return {
    today: brisbaneToday(),
    organisations,
    people,
    tasks,
    decisions,
    projects,
    opportunities,
    issues,
    metrics,
    knowledge,
    driveLinks,
    previousGeneratedAt: previous?.generated_at ?? null,
  };
}
