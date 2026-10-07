PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organisations (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES organisations(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('business', 'brand', 'client', 'partner', 'supplier')),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  description TEXT,
  owner TEXT,
  website TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  pulse_status TEXT CHECK (pulse_status IN ('healthy', 'watch', 'action_required')),
  interpretation TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  name TEXT NOT NULL,
  role TEXT,
  responsibilities TEXT,
  manager_id TEXT REFERENCES people(id),
  contact_information TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT REFERENCES people(id),
  status TEXT NOT NULL CHECK (status IN ('idea', 'planned', 'active', 'blocked', 'waiting', 'completed', 'cancelled')),
  priority TEXT NOT NULL,
  expected_impact TEXT,
  start_date TEXT,
  due_date TEXT,
  next_action TEXT,
  blocked_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  organisation_id TEXT REFERENCES organisations(id),
  title TEXT NOT NULL,
  description TEXT,
  owner_id TEXT REFERENCES people(id),
  priority TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'waiting', 'blocked', 'done', 'dismissed', 'delegated')),
  due_date TEXT,
  requires_hayden INTEGER NOT NULL DEFAULT 0,
  estimated_minutes INTEGER,
  expected_impact TEXT,
  recommended_action TEXT,
  why_it_matters TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  context TEXT,
  options TEXT,
  recommended_option TEXT,
  decision TEXT,
  decision_owner_id TEXT REFERENCES people(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'decided', 'deferred', 'cancelled')),
  deadline TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  platform TEXT,
  offer TEXT,
  audience TEXT,
  status TEXT NOT NULL,
  budget REAL,
  start_date TEXT,
  landing_page TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS campaign_metrics (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  date TEXT NOT NULL,
  spend REAL,
  impressions INTEGER,
  reach INTEGER,
  clicks INTEGER,
  leads INTEGER,
  cpl REAL,
  appointments INTEGER,
  cost_per_appointment REAL,
  shows INTEGER,
  show_rate REAL,
  sales INTEGER,
  revenue REAL,
  cac REAL,
  roas REAL
);

CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  brand TEXT,
  platform TEXT,
  content_type TEXT,
  concept TEXT,
  hook TEXT,
  status TEXT,
  publish_date TEXT,
  views INTEGER,
  reach INTEGER,
  engagement REAL,
  leads INTEGER,
  campaign_id TEXT REFERENCES campaigns(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  name TEXT NOT NULL,
  hypothesis TEXT,
  variable TEXT,
  control TEXT,
  variant TEXT,
  status TEXT,
  start_date TEXT,
  end_date TEXT,
  result TEXT,
  learning TEXT
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  category TEXT,
  severity TEXT,
  title TEXT NOT NULL,
  description TEXT,
  detected_by TEXT,
  assigned_to TEXT,
  requires_hayden INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  category TEXT,
  title TEXT NOT NULL,
  description TEXT,
  potential_value TEXT,
  confidence TEXT,
  recommended_action TEXT,
  owner_id TEXT REFERENCES people(id),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  trigger TEXT,
  input_summary TEXT,
  output_summary TEXT,
  actions_taken TEXT,
  items_escalated TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  category TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  confidence TEXT,
  last_verified TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organisation_metrics (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  metric_date TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  category TEXT,
  what_happened TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  recommended_response TEXT NOT NULL,
  responsible TEXT,
  requires_hayden INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mandate TEXT NOT NULL,
  organisation_id TEXT REFERENCES organisations(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'placeholder')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  resource TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('READ', 'CREATE', 'UPDATE', 'EXECUTE', 'ESCALATE')),
  requires_approval INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  created_at TEXT NOT NULL,
  evidence TEXT,
  reasoning TEXT,
  recommendation TEXT,
  confidence TEXT,
  actions_taken TEXT,
  entity_type TEXT,
  entity_id TEXT
);

CREATE TABLE IF NOT EXISTS priority_assessments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  financial_impact INTEGER NOT NULL CHECK (financial_impact BETWEEN 0 AND 5),
  urgency INTEGER NOT NULL CHECK (urgency BETWEEN 0 AND 5),
  strategic_importance INTEGER NOT NULL CHECK (strategic_importance BETWEEN 0 AND 5),
  hayden_dependency INTEGER NOT NULL CHECK (hayden_dependency BETWEEN 0 AND 5),
  risk INTEGER NOT NULL CHECK (risk BETWEEN 0 AND 5),
  time_cost INTEGER NOT NULL CHECK (time_cost BETWEEN 0 AND 5),
  score INTEGER NOT NULL CHECK (score BETWEEN -5 AND 60),
  override_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_organisations_parent ON organisations(parent_id);
CREATE INDEX IF NOT EXISTS idx_people_org ON people(organisation_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_tasks_attention ON tasks(requires_hayden, status);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_metrics_campaign_date ON campaign_metrics(campaign_id, date);
CREATE INDEX IF NOT EXISTS idx_knowledge_org ON knowledge(organisation_id);
CREATE INDEX IF NOT EXISTS idx_findings_created ON findings(created_at);

CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  organisation_id TEXT REFERENCES organisations(id),
  project_id TEXT REFERENCES projects(id),
  requested_by TEXT NOT NULL,
  requested_by_label TEXT,
  status TEXT NOT NULL,
  priority TEXT,
  input_context TEXT,
  output_summary TEXT,
  findings TEXT,
  recommendations TEXT,
  tasks_created TEXT,
  decisions_created TEXT,
  evidence TEXT,
  confidence TEXT,
  started_at TEXT,
  completed_at TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd REAL,
  parent_job_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_handoffs (
  id TEXT PRIMARY KEY,
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  from_job_id TEXT,
  to_job_id TEXT,
  objective TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creative_concepts (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  brand TEXT,
  title TEXT NOT NULL,
  concept TEXT,
  hook TEXT,
  format TEXT,
  objective TEXT,
  audience TEXT,
  script_outline TEXT,
  visual_direction TEXT,
  why_it_may_work TEXT,
  cta TEXT,
  production_complexity TEXT,
  variations TEXT,
  next_action TEXT,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  production_status TEXT,
  performance_link TEXT,
  parent_concept_id TEXT,
  variation_of TEXT,
  notes TEXT,
  job_id TEXT,
  approved_at TEXT,
  approved_by TEXT
);

CREATE TABLE IF NOT EXISTS media_formats (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  name TEXT NOT NULL,
  brand TEXT,
  description TEXT,
  content_pillar TEXT,
  repeatability_score INTEGER,
  production_complexity TEXT,
  commercial_relevance TEXT,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  job_id TEXT
);

CREATE TABLE IF NOT EXISTS agent_notices (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  job_id TEXT,
  summary TEXT NOT NULL,
  requires_hayden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS production_model_profiles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  allowed_durations TEXT NOT NULL DEFAULT 'unknown',
  prompt_style TEXT NOT NULL DEFAULT 'unknown',
  start_end_frames TEXT NOT NULL DEFAULT 'unknown',
  audio_support TEXT NOT NULL DEFAULT 'unknown',
  dialogue_support TEXT NOT NULL DEFAULT 'unknown',
  aspect_ratios TEXT NOT NULL DEFAULT 'unknown',
  known_limitations TEXT NOT NULL DEFAULT 'unknown',
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS production_rules (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL,
  scope TEXT NOT NULL,
  organisation_id TEXT,
  project_id TEXT,
  model_profile_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  superseded_by_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS production_packs (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  supersedes_id TEXT,
  creative_concept_id TEXT,
  organisation_id TEXT,
  project_id TEXT,
  brand TEXT,
  production_type TEXT NOT NULL,
  aspect_ratio TEXT,
  target_duration TEXT,
  number_of_scenes INTEGER NOT NULL DEFAULT 0,
  production_owner TEXT,
  assigned_at TEXT,
  due_date TEXT,
  status TEXT NOT NULL,
  script TEXT,
  voice_direction TEXT,
  global_visual_direction TEXT,
  character_bible TEXT,
  location_bible TEXT,
  continuity_rules TEXT,
  editing_notes TEXT,
  music_direction TEXT,
  sound_direction TEXT,
  on_screen_text TEXT,
  cta TEXT,
  disclaimers TEXT,
  generation_model TEXT,
  model_profile_id TEXT,
  continuity_status TEXT,
  continuity_report TEXT,
  duration_report TEXT,
  checklist TEXT,
  unapproved_override INTEGER NOT NULL DEFAULT 0,
  executor TEXT NOT NULL DEFAULT 'human',
  created_by TEXT NOT NULL,
  approved_by TEXT,
  job_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS production_scenes (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  scene_number INTEGER NOT NULL,
  duration_seconds REAL,
  objective TEXT,
  visual TEXT,
  action TEXT,
  characters TEXT,
  location TEXT,
  camera TEXT,
  start_frame TEXT,
  end_frame TEXT,
  video_prompt TEXT,
  voiceover TEXT,
  speaker TEXT,
  sfx TEXT,
  music_notes TEXT,
  on_screen_text TEXT,
  continuity_from TEXT,
  continuity_into TEXT,
  production_notes TEXT
);

CREATE TABLE IF NOT EXISTS production_feedback (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  scene_id TEXT,
  model_profile_id TEXT,
  kind TEXT NOT NULL,
  note TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_agent ON agent_jobs(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_concepts_brand ON creative_concepts(organisation_id, status);
CREATE TABLE IF NOT EXISTS generated_assets (
  id TEXT PRIMARY KEY,
  production_pack_id TEXT,
  scene_id TEXT,
  concept_id TEXT,
  organisation_id TEXT,
  project_id TEXT,
  asset_type TEXT NOT NULL,
  asset_role TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  prompt TEXT,
  aspect_ratio TEXT,
  width INTEGER,
  height INTEGER,
  generation_status TEXT NOT NULL,
  generation_job_id TEXT,
  storage_location TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  parent_asset_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  error_message TEXT,
  start_frame_asset_id TEXT,
  end_frame_asset_id TEXT,
  duration_requested REAL,
  duration_actual REAL,
  provider_metadata TEXT,
  cost_note TEXT,
  started_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_packs_status ON production_packs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_scenes_pack ON production_scenes(pack_id, scene_number);
CREATE INDEX IF NOT EXISTS idx_assets_pack ON generated_assets(production_pack_id, asset_role);

CREATE TABLE IF NOT EXISTS work_submissions (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  note TEXT,
  link TEXT,
  file_path TEXT,
  file_name TEXT,
  asset_id TEXT,
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  review_status TEXT NOT NULL,
  feedback TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT
);

CREATE TABLE IF NOT EXISTS work_blockers (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  waiting_on TEXT NOT NULL,
  needs_hayden INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  cleared_at TEXT
);

CREATE TABLE IF NOT EXISTS work_notes (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_outcomes (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  executor_id TEXT,
  version_count INTEGER NOT NULL,
  feedback_count INTEGER NOT NULL,
  blocked_note TEXT,
  summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_suggestions (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  feedback TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  organisation_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_source ON work_submissions(source_type, source_id, version);
CREATE INDEX IF NOT EXISTS idx_blockers_source ON work_blockers(source_type, source_id, cleared_at);
CREATE INDEX IF NOT EXISTS idx_assets_scene ON generated_assets(scene_id, asset_role, version);

CREATE TABLE IF NOT EXISTS ops_imports (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  source_name TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  schema_mapping TEXT NOT NULL,
  rows_accepted INTEGER NOT NULL,
  rows_rejected INTEGER NOT NULL,
  validation_issues TEXT NOT NULL,
  file_name TEXT
);

CREATE TABLE IF NOT EXISTS ops_import_drafts (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  file_name TEXT NOT NULL,
  csv_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ops_mappings (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  dataset_kind TEXT NOT NULL,
  mapping TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  UNIQUE (organisation_id, dataset_kind)
);

CREATE TABLE IF NOT EXISTS ops_leads (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  import_id TEXT REFERENCES ops_imports(id),
  external_id TEXT,
  name TEXT,
  phone TEXT,
  source_name TEXT,
  owner_name TEXT,
  stage TEXT,
  tags TEXT,
  status TEXT,
  created_at TEXT,
  first_contact_at TEXT,
  callback_due TEXT,
  attempt_count INTEGER,
  expected_attempts INTEGER,
  external_source TEXT,
  contact_external_id TEXT,
  stage_changed_at TEXT
);

CREATE TABLE IF NOT EXISTS ops_appointments (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  import_id TEXT REFERENCES ops_imports(id),
  lead_id TEXT REFERENCES ops_leads(id),
  setter_name TEXT,
  consultant_name TEXT,
  strategist_name TEXT,
  campaign_name TEXT,
  booked_at TEXT,
  scheduled_at TEXT,
  status TEXT NOT NULL,
  booking_delay_days INTEGER,
  confirmation_recorded INTEGER,
  partner_uncertain INTEGER,
  reschedule_requested INTEGER,
  attendance_evidence TEXT,
  evidence_type TEXT,
  rebooking_attempted INTEGER,
  rebooked_at TEXT,
  pipeline_stage TEXT,
  tags TEXT,
  external_id TEXT,
  external_source TEXT
);

CREATE TABLE IF NOT EXISTS ops_activities (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  import_id TEXT REFERENCES ops_imports(id),
  lead_id TEXT REFERENCES ops_leads(id),
  kind TEXT NOT NULL,
  actor_name TEXT,
  occurred_at TEXT,
  outcome TEXT,
  evidence TEXT,
  external_id TEXT,
  external_source TEXT,
  duration_seconds INTEGER,
  source_url TEXT
);

CREATE TABLE IF NOT EXISTS ops_transcripts (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  call_external_id TEXT NOT NULL UNIQUE,
  lead_id TEXT,
  status TEXT NOT NULL,
  utterances TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ops_signals (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  lead_id TEXT,
  call_external_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  speaker TEXT,
  evidence TEXT NOT NULL,
  occurred_at TEXT,
  confidence TEXT NOT NULL,
  appointment_id TEXT
);

CREATE TABLE IF NOT EXISTS ops_capabilities (
  id TEXT PRIMARY KEY,
  integration TEXT NOT NULL,
  capability TEXT NOT NULL,
  access TEXT NOT NULL,
  detail TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ops_outcomes (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  import_id TEXT REFERENCES ops_imports(id),
  lead_id TEXT,
  appointment_id TEXT,
  kind TEXT NOT NULL,
  revenue REAL,
  occurred_at TEXT,
  owner_name TEXT
);

CREATE TABLE IF NOT EXISTS ops_kpi_definitions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  kpi_key TEXT NOT NULL,
  label TEXT NOT NULL,
  formula TEXT NOT NULL,
  numerator TEXT NOT NULL,
  denominator TEXT NOT NULL,
  ambiguous INTEGER NOT NULL,
  status TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS ops_kpi_targets (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  kpi_key TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_label TEXT NOT NULL,
  period_label TEXT NOT NULL,
  target_value REAL NOT NULL,
  target_unit TEXT NOT NULL,
  source_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ops_findings (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  finding_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  what_happened TEXT NOT NULL,
  evidence TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  magnitude TEXT,
  why_it_matters TEXT NOT NULL,
  possible_causes TEXT NOT NULL,
  confidence TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  suggested_owner_id TEXT,
  hayden_required INTEGER NOT NULL,
  task_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ops_connections (
  id TEXT PRIMARY KEY,
  organisation_id TEXT,
  account_label TEXT,
  secret_payload TEXT,
  status TEXT NOT NULL,
  last_sync_at TEXT,
  last_error TEXT,
  last_summary TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_appointments_org ON ops_appointments(organisation_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_ops_findings_org ON ops_findings(organisation_id, status);
