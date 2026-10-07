export type PulseStatus = "healthy" | "watch" | "action_required";
export type OrgType = "business" | "brand" | "client" | "partner" | "supplier";
export type ProjectStatus = "idea" | "planned" | "active" | "blocked" | "waiting" | "completed" | "cancelled";
export type TaskStatus = "open" | "in_progress" | "waiting" | "blocked" | "done" | "dismissed" | "delegated";

export type Organisation = {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  type: OrgType;
  status: string;
  description: string | null;
  owner: string | null;
  website: string | null;
  notes: string | null;
  sort_order: number;
  pulse_status: PulseStatus | null;
  interpretation: string | null;
  data_status?: string | null;
  source_type?: string | null;
  source_name?: string | null;
  strategic_role?: string | null;
  strategic_priority?: number | null;
  growth_intent?: string | null;
  hayden_role?: string | null;
  desired_hayden_involvement?: string | null;
  business_model?: string | null;
  primary_objective?: string | null;
  time_horizon?: string | null;
  created_at: string;
  updated_at: string;
};

export type Person = {
  id: string;
  organisation_id: string | null;
  name: string;
  role: string | null;
  responsibilities: string | null;
  manager_id: string | null;
  contact_information: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  organisation_id: string | null;
  name: string;
  description: string | null;
  owner_id: string | null;
  status: ProjectStatus;
  priority: string;
  expected_impact: string | null;
  start_date: string | null;
  due_date: string | null;
  next_action: string | null;
  blocked_by: string | null;
  objective?: string | null;
  hayden_involvement?: string | null;
  health?: string | null;
  data_status?: string | null;
  created_at: string;
  updated_at: string;
  organisation_name: string | null;
  owner_name: string | null;
};

export type Task = {
  id: string;
  project_id: string | null;
  organisation_id: string | null;
  title: string;
  description: string | null;
  owner_id: string | null;
  priority: string;
  status: TaskStatus;
  due_date: string | null;
  requires_hayden: number;
  estimated_minutes: number | null;
  expected_impact: string | null;
  recommended_action: string | null;
  why_it_matters: string | null;
  source: string | null;
  created_at: string;
  completed_at: string | null;
  expected_outcome?: string | null;
  data_status?: string | null;
  organisation_name: string | null;
  owner_name: string | null;
  project_name: string | null;
};

export type Decision = {
  id: string;
  organisation_id: string | null;
  project_id: string | null;
  title: string;
  context: string | null;
  options: string[];
  recommended_option: string | null;
  decision: string | null;
  evidence?: string | null;
  cost_of_delay?: string | null;
  data_status?: string | null;
  decision_owner_id: string | null;
  status: string;
  deadline: string | null;
  created_at: string;
  decided_at: string | null;
  organisation_name: string | null;
  owner_name: string | null;
};

export type Campaign = {
  id: string;
  organisation_id: string;
  name: string;
  platform: string | null;
  offer: string | null;
  audience: string | null;
  status: string;
  budget: number | null;
  start_date: string | null;
  landing_page: string | null;
  notes: string | null;
  organisation_name?: string | null;
};

export type CampaignMetric = {
  id: string;
  campaign_id: string;
  date: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  leads: number | null;
  cpl: number | null;
  appointments: number | null;
  cost_per_appointment: number | null;
  shows: number | null;
  show_rate: number | null;
  sales: number | null;
  revenue: number | null;
  cac: number | null;
  roas: number | null;
};

export type ContentItem = {
  id: string;
  organisation_id: string | null;
  brand: string | null;
  platform: string | null;
  content_type: string | null;
  concept: string | null;
  hook: string | null;
  status: string | null;
  publish_date: string | null;
  views: number | null;
  reach: number | null;
  engagement: number | null;
  leads: number | null;
  campaign_id: string | null;
  notes: string | null;
  data_status?: string | null;
};

export type Experiment = {
  id: string;
  organisation_id: string | null;
  name: string;
  hypothesis: string | null;
  variable: string | null;
  control: string | null;
  variant: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  result: string | null;
  learning: string | null;
  organisation_name?: string | null;
};

export type Issue = {
  id: string;
  organisation_id: string | null;
  category: string | null;
  severity: string | null;
  title: string;
  description: string | null;
  detected_by: string | null;
  assigned_to: string | null;
  requires_hayden: number;
  status: string;
  detected_at: string;
  resolved_at: string | null;
  organisation_name?: string | null;
  assignee_name?: string | null;
};

export type Opportunity = {
  id: string;
  organisation_id: string | null;
  category: string | null;
  title: string;
  description: string | null;
  potential_value: string | null;
  confidence: string | null;
  recommended_action: string | null;
  owner_id: string | null;
  status: string;
  created_at: string;
  organisation_name?: string | null;
  owner_name?: string | null;
};

export type Knowledge = {
  id: string;
  organisation_id: string | null;
  category: string | null;
  title: string;
  content: string;
  source: string | null;
  confidence: string | null;
  last_verified: string | null;
  created_at: string;
  updated_at: string;
  context_type?: string | null;
  effective_from?: string | null;
  effective_until?: string | null;
  supersedes_id?: string | null;
  superseded_by_id?: string | null;
  data_status?: string | null;
  source_name?: string | null;
  organisation_name?: string | null;
};

export type OpenQuestion = {
  id: string;
  organisation_id: string | null;
  person_id: string | null;
  question: string;
  why_it_matters: string | null;
  status: string;
  data_status: string;
  source_type: string | null;
  source_name: string | null;
  created_at: string;
  updated_at: string;
  organisation_name?: string | null;
};

export type OpportunityFactor = {
  id: string;
  factor_key: string;
  label: string;
  guidance: string;
  sort_order: number;
};

export type Metric = {
  id: string;
  organisation_id: string;
  metric_date: string;
  metric_key: string;
  label: string;
  value: string;
  sort_order: number;
  data_status?: string | null;
};

export type Finding = {
  id: string;
  organisation_id: string | null;
  category: string | null;
  what_happened: string;
  why_it_matters: string;
  recommended_response: string;
  responsible: string | null;
  requires_hayden: number;
  source: string | null;
  created_at: string;
  data_status?: string | null;
  organisation_name?: string | null;
};

export type Agent = {
  id: string;
  slug: string;
  name: string;
  mandate: string;
  organisation_id: string | null;
  status: string;
  created_at: string;
  organisation_name?: string | null;
};

export type AgentPermission = {
  id: string;
  agent_id: string;
  resource: string;
  level: string;
  requires_approval: number;
  notes: string | null;
};

export type Integration = {
  id: string;
  slug: string;
  name: string;
  status: string;
  notes: string | null;
};

export type TeamMember = Person & {
  organisation_name: string | null;
  manager_name: string | null;
  open_tasks: number;
  overdue_tasks: number;
  open_issues: number;
  priorities: string[];
  last_update: string | null;
};

export type PulseCard = {
  organisation: Organisation;
  metrics: Metric[];
};
