import type Database from "better-sqlite3";
import { ensureProductionDefaults } from "../factory/defaults";
import { ensureVisualIntelligence } from "../visual/schema";
import { ensureContentFactory } from "../content/schema";

const PROVENANCE_TABLES = [
  "organisations",
  "people",
  "projects",
  "tasks",
  "decisions",
  "campaigns",
  "campaign_metrics",
  "content",
  "experiments",
  "issues",
  "opportunities",
  "findings",
  "knowledge",
  "organisation_metrics",
];

const FACTOR_TABLES = ["tasks", "decisions"];

function columnNames(db: Database.Database, table: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function ensureColumn(db: Database.Database, table: string, name: string, definition: string) {
  if (columnNames(db, table).has(name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

export function migrate(db: Database.Database) {
  for (const table of PROVENANCE_TABLES) {
    ensureColumn(db, table, "data_status", "TEXT NOT NULL DEFAULT 'manual'");
    ensureColumn(db, table, "source_type", "TEXT");
    ensureColumn(db, table, "source_name", "TEXT");
    ensureColumn(db, table, "source_record", "TEXT");
    ensureColumn(db, table, "last_updated", "TEXT");
  }

  for (const table of FACTOR_TABLES) {
    for (const factor of ["financial_impact", "urgency", "strategic_importance", "hayden_dependency", "risk", "time_cost"]) {
      ensureColumn(db, table, factor, "INTEGER NOT NULL DEFAULT 0");
    }
  }

  ensureColumn(db, "projects", "objective", "TEXT");
  ensureColumn(db, "projects", "hayden_involvement", "TEXT");
  ensureColumn(db, "projects", "health", "TEXT");
  ensureColumn(db, "tasks", "expected_outcome", "TEXT");
  ensureColumn(db, "decisions", "evidence", "TEXT");
  ensureColumn(db, "decisions", "cost_of_delay", "TEXT");

  ensureColumn(db, "priority_assessments", "reasoning", "TEXT");
  ensureColumn(db, "priority_assessments", "source", "TEXT");
  ensureColumn(db, "priority_assessments", "manual_override", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "priority_assessments", "classification", "TEXT");
  ensureColumn(db, "priority_assessments", "classification_reason", "TEXT");

  for (const column of [
    ["strategic_role", "TEXT"],
    ["strategic_priority", "INTEGER"],
    ["growth_intent", "TEXT"],
    ["hayden_role", "TEXT"],
    ["desired_hayden_involvement", "TEXT"],
    ["business_model", "TEXT"],
    ["primary_objective", "TEXT"],
    ["time_horizon", "TEXT"],
  ] as const) {
    ensureColumn(db, "organisations", column[0], column[1]);
  }

  for (const column of [
    ["context_type", "TEXT"],
    ["effective_from", "TEXT"],
    ["effective_until", "TEXT"],
    ["supersedes_id", "TEXT"],
    ["superseded_by_id", "TEXT"],
  ] as const) {
    ensureColumn(db, "knowledge", column[0], column[1]);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS delegations (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      assignee_type TEXT NOT NULL,
      assignee_id TEXT NOT NULL,
      deadline TEXT,
      expected_outcome TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      kind TEXT NOT NULL,
      data_status TEXT NOT NULL DEFAULT 'manual',
      source_type TEXT,
      source_name TEXT,
      created_at TEXT NOT NULL,
      linked_entity_type TEXT,
      linked_entity_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_delegations_entity ON delegations(entity_type, entity_id, active);
    CREATE INDEX IF NOT EXISTS idx_assessments_entity ON priority_assessments(entity_type, entity_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at);
    CREATE TABLE IF NOT EXISTS open_questions (
      id TEXT PRIMARY KEY,
      organisation_id TEXT REFERENCES organisations(id),
      person_id TEXT REFERENCES people(id),
      question TEXT NOT NULL,
      why_it_matters TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      data_status TEXT NOT NULL DEFAULT 'manual',
      source_type TEXT,
      source_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS opportunity_framework (
      id TEXT PRIMARY KEY,
      factor_key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      guidance TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS opportunity_assessments (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      strategic_alignment INTEGER,
      revenue_potential INTEGER,
      media_leverage INTEGER,
      scalability INTEGER,
      founder_dependency INTEGER,
      complexity INTEGER,
      speed_to_validation INTEGER,
      capital_requirement INTEGER,
      synergy INTEGER,
      conviction INTEGER,
      notes TEXT,
      decision TEXT,
      data_status TEXT NOT NULL DEFAULT 'manual',
      source_type TEXT,
      source_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_context ON knowledge(context_type, superseded_by_id);
    CREATE INDEX IF NOT EXISTS idx_open_questions_status ON open_questions(status);

    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      agent TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      context_snapshot TEXT NOT NULL,
      brief_json TEXT NOT NULL,
      brief_text TEXT NOT NULL,
      confidence TEXT,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_briefs_generated ON briefs(generated_at);
    CREATE TABLE IF NOT EXISTS brief_feedback (
      id TEXT PRIMARY KEY,
      brief_id TEXT,
      recommendation_id TEXT,
      verdict TEXT NOT NULL,
      comment TEXT,
      memory_status TEXT NOT NULL DEFAULT 'pending_review',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS classification_proposals (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      original_classification TEXT NOT NULL,
      ai_classification TEXT NOT NULL,
      reason TEXT NOT NULL,
      confidence TEXT NOT NULL,
      source TEXT NOT NULL,
      run_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chief_runs (
      id TEXT PRIMARY KEY,
      trigger TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      context_retrieved TEXT NOT NULL,
      records_considered INTEGER NOT NULL,
      recommendations TEXT NOT NULL,
      classification_changes TEXT NOT NULL,
      confidence TEXT,
      duration_ms INTEGER,
      error TEXT,
      reasoning_summary TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drive_connections (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      account_email TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry TEXT,
      scope TEXT,
      last_sync_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drive_sources (
      id TEXT PRIMARY KEY,
      drive_folder_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      path TEXT,
      approved INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drive_files (
      id TEXT PRIMARY KEY,
      drive_file_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mime_type TEXT,
      folder_id TEXT,
      folder_path TEXT,
      modified_time TEXT,
      web_url TEXT,
      size INTEGER,
      indexed_at TEXT,
      last_checked TEXT,
      content_hash TEXT,
      content_text TEXT,
      organisation_id TEXT,
      project_id TEXT,
      brand TEXT,
      knowledge_category TEXT,
      classification_confidence TEXT,
      index_status TEXT NOT NULL,
      source_folder_id TEXT,
      removed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_drive_files_org ON drive_files(organisation_id, knowledge_category);
    CREATE TABLE IF NOT EXISTS project_drive_links (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      drive_file_id TEXT,
      drive_folder_id TEXT,
      label TEXT NOT NULL,
      web_url TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drive_sync_runs (
      id TEXT PRIMARY KEY,
      trigger TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      files_new INTEGER NOT NULL DEFAULT 0,
      files_modified INTEGER NOT NULL DEFAULT 0,
      files_removed INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
  `);
  db.prepare(`UPDATE integrations SET notes = ? WHERE id = 'google-drive'`).run(
    "Read-only. Indexes only the folders you approve.",
  );

  db.prepare(
    `UPDATE agents
     SET mandate = ?
     WHERE slug = 'chief-of-staff'`,
  ).run(
    "Protect Hayden's time. Read retrieved records, recommend, classify, and prepare briefs. Cannot send, publish, spend, delete, or change CRM records.",
  );

  ensureOperations(db);
  ensureLiveConnections(db);
  ensureHardenedOps(db);
  ensureGpuProof(db);
  ensureVisualIntelligence(db);
  ensureContentFactory(db);

  const chief = db.prepare(`SELECT id FROM agents WHERE id = 'chief-of-staff'`).get();
  if (!chief) return;

  const grants: Array<[string, string, string, number, string]> = [
    ["chief-findings", "findings", "CREATE", 0, "May create an internal finding. Cannot delete records."],
    ["chief-opportunities", "opportunities", "CREATE", 0, "May create an internal opportunity. Cannot launch or spend."],
  ];
  const insertGrant = db.prepare(
    `INSERT INTO agent_permissions (id, agent_id, resource, level, requires_approval, notes)
     SELECT ?, 'chief-of-staff', ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM agent_permissions
       WHERE agent_id = 'chief-of-staff' AND resource = ? AND level = ?
     )`,
  );
  for (const [id, resource, level, approval, notes] of grants) {
    insertGrant.run(id, resource, level, approval, notes, resource, level);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      organisation_id TEXT,
      project_id TEXT,
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
      organisation_id TEXT,
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
      organisation_id TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_agent ON agent_jobs(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_concepts_brand ON creative_concepts(organisation_id, status);
  `);

  const activeMandates: Array<[string, string]> = [
    ["chief-of-staff", "Protect Hayden's time. Route specialist work. Summarise agent output. Cannot send, publish, spend, delete, or change CRM records."],
    ["creative", "Own creative thinking across advertising and owned media. Produce concepts, hooks and scripts. A concept is not a finished video. Cannot publish or spend."],
    ["growth", "Own commercial growth logic: offers, funnels, acquisition and experiments. No live data means no performance claim. Cannot launch campaigns or spend."],
    ["media", "Build owned audience and repeatable formats for Media Empire, Property Made Simple and Brisbane Collective. Cannot publish."],
    ["content", "AI Production Director. Convert an approved concept into production instructions. A pack is not a finished video. Cannot publish, send, or spend."],
  ];
  const setMandate = db.prepare(`UPDATE agents SET status = 'active', mandate = ? WHERE id = ?`);
  for (const [id, mandate] of activeMandates) setMandate.run(mandate, id);

  const specialistGrants: Array<[string, string, string, string, number, string]> = [
    ["creative-read", "creative", "*", "READ", 0, "Can read shared operating memory."],
    ["creative-concepts", "creative", "creative_concepts", "CREATE", 0, "Can store concepts in the creative library."],
    ["creative-tasks", "creative", "tasks", "CREATE", 0, "May propose a task. Cannot publish or produce the file."],
    ["creative-publish", "creative", "publish_content", "EXECUTE", 1, "Cannot publish."],
    ["creative-spend", "creative", "spend", "EXECUTE", 1, "Cannot spend."],
    ["growth-read", "growth", "*", "READ", 0, "Can read shared operating memory."],
    ["growth-experiments", "growth", "experiments", "CREATE", 0, "May propose an experiment. Cannot mark it successful."],
    ["growth-tasks", "growth", "tasks", "CREATE", 0, "May propose a task."],
    ["growth-launch", "growth", "launch_campaign", "EXECUTE", 1, "Cannot launch or spend."],
    ["growth-publish", "growth", "publish_content", "EXECUTE", 1, "Cannot publish."],
    ["growth-spend", "growth", "spend", "EXECUTE", 1, "Cannot spend."],
    ["media-read", "media", "*", "READ", 0, "Can read shared operating memory."],
    ["media-formats", "media", "media_formats", "CREATE", 0, "May store a format as an idea."],
    ["media-tasks", "media", "tasks", "CREATE", 0, "May propose a task."],
    ["media-publish", "media", "publish_content", "EXECUTE", 1, "Cannot publish."],
    ["media-spend", "media", "spend", "EXECUTE", 1, "Cannot spend."],
    ["content-read", "content", "*", "READ", 0, "Can read shared operating memory."],
    ["content-packs", "content", "production_packs", "CREATE", 0, "Can store a production pack. A pack is not a finished asset."],
    ["content-publish", "content", "publish_content", "EXECUTE", 1, "Cannot publish."],
    ["content-spend", "content", "spend", "EXECUTE", 1, "Cannot spend."],
  ];
  const insertSpecialist = db.prepare(
    `INSERT INTO agent_permissions (id, agent_id, resource, level, requires_approval, notes)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM agent_permissions WHERE agent_id = ? AND resource = ? AND level = ?
     )`,
  );
  for (const [id, agentId, resource, level, approval, notes] of specialistGrants) {
    insertSpecialist.run(id, agentId, resource, level, approval, notes, agentId, resource, level);
  }
  ensureProductionDefaults(db);
  ensureVideoAssetColumns(db);
  recordVerifiedOmniProfile(db);
  ensureWorkLoop(db);
  ensureOperations(db);
  ensureLiveConnections(db);
  ensureHardenedOps(db);
  ensureGpuProof(db);
  ensureVisualIntelligence(db);
  ensureContentFactory(db);
}

function ensureWorkLoop(db: Database.Database) {
  db.exec(`
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
  `);
}

function ensureOperations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ops_imports (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL,
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
      organisation_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      csv_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ops_mappings (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL,
      dataset_kind TEXT NOT NULL,
      mapping TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      UNIQUE (organisation_id, dataset_kind)
    );
    CREATE TABLE IF NOT EXISTS ops_leads (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL,
      import_id TEXT,
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
      expected_attempts INTEGER
    );
    CREATE TABLE IF NOT EXISTS ops_appointments (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL,
      import_id TEXT,
      lead_id TEXT,
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
      tags TEXT
    );
    CREATE TABLE IF NOT EXISTS ops_activities (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL,
      import_id TEXT,
      lead_id TEXT,
      kind TEXT NOT NULL,
      actor_name TEXT,
      occurred_at TEXT,
      outcome TEXT,
      evidence TEXT
    );
    CREATE TABLE IF NOT EXISTS ops_outcomes (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL,
      import_id TEXT,
      lead_id TEXT,
      appointment_id TEXT,
      kind TEXT NOT NULL,
      revenue REAL,
      occurred_at TEXT,
      owner_name TEXT
    );
    CREATE TABLE IF NOT EXISTS ops_kpi_definitions (
      id TEXT PRIMARY KEY,
      organisation_id TEXT,
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
      organisation_id TEXT NOT NULL,
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
      organisation_id TEXT NOT NULL,
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
  `);
}

function ensureLiveConnections(db: Database.Database) {
  ensureColumn(db, "ops_leads", "external_source", "TEXT");
  ensureColumn(db, "ops_appointments", "external_id", "TEXT");
  ensureColumn(db, "ops_appointments", "external_source", "TEXT");
  ensureColumn(db, "ops_activities", "external_id", "TEXT");
  ensureColumn(db, "ops_activities", "external_source", "TEXT");
  ensureColumn(db, "ops_activities", "duration_seconds", "INTEGER");
  ensureColumn(db, "ops_activities", "source_url", "TEXT");
  ensureColumn(db, "ops_leads", "contact_external_id", "TEXT");
  ensureColumn(db, "ops_leads", "stage_changed_at", "TEXT");
  db.exec(`
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
  `);
  db.exec(`
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
  `);
  db.prepare(
    `INSERT INTO integrations (id, slug, name, status, notes)
     SELECT 'gohighlevel', 'gohighlevel', 'GoHighLevel', 'disconnected', 'Read-only. Contacts and appointments. Nothing is written back.'
     WHERE NOT EXISTS (SELECT 1 FROM integrations WHERE id = 'gohighlevel')`,
  ).run();
  db.prepare(`UPDATE integrations SET notes = ? WHERE id = 'aircall' AND notes = 'Call activity.'`).run(
    "Read-only. Calls only. Nothing is written back.",
  );
}

function ensureHardenedOps(db: Database.Database) {
  ensureColumn(db, "ops_leads", "person_id", "TEXT");
  ensureColumn(db, "ops_leads", "pipeline_name", "TEXT");
  ensureColumn(db, "ops_leads", "lead_source", "TEXT");
  ensureColumn(db, "ops_leads", "source_detail", "TEXT");
  ensureColumn(db, "ops_leads", "email", "TEXT");
  ensureColumn(db, "ops_appointments", "person_id", "TEXT");
  ensureColumn(db, "ops_appointments", "scheduled_timezone", "TEXT");
  ensureColumn(db, "ops_appointments", "time_unknown", "INTEGER");
  ensureColumn(db, "ops_appointments", "source_updated_at", "TEXT");
  ensureColumn(db, "ops_appointments", "ends_at", "TEXT");
  ensureColumn(db, "ops_activities", "person_id", "TEXT");
  ensureColumn(db, "ops_signals", "analysed_at", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS ops_people (
      id TEXT PRIMARY KEY,
      phone_key TEXT UNIQUE,
      email TEXT,
      display_name TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ops_sync_state (
      integration TEXT PRIMARY KEY,
      cursor TEXT,
      last_attempted_at TEXT,
      last_successful_at TEXT,
      latest_source_at TEXT,
      records_added INTEGER,
      records_updated INTEGER,
      transcripts_discovered INTEGER,
      error TEXT,
      partial_error TEXT,
      full_scan_at TEXT,
      lock_until TEXT
    );
    CREATE TABLE IF NOT EXISTS ops_booking_reviews (
      id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL UNIQUE,
      lead_id TEXT,
      person_id TEXT,
      booked_at TEXT,
      call_ids TEXT NOT NULL,
      analysis_status TEXT NOT NULL,
      transcript_fingerprint TEXT,
      analysed_at TEXT,
      unable_reason TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ops_no_show_events (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      person_id TEXT,
      appointment_id TEXT,
      organisation_id TEXT,
      occurred_at TEXT,
      source TEXT NOT NULL,
      source_record TEXT UNIQUE,
      owner_name TEXT,
      confidence TEXT NOT NULL,
      recovery_status TEXT NOT NULL,
      attempt_count INTEGER,
      detail TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

export function ensureGpuProof(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gpu_infra (
      id TEXT PRIMARY KEY,
      volume_id TEXT,
      volume_name TEXT,
      volume_gb INTEGER,
      data_center TEXT,
      volume_hourly_usd REAL,
      volume_rate_source TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gpu_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_id TEXT,
      gpu_name TEXT,
      data_center TEXT,
      volume_id TEXT,
      volume_gb INTEGER,
      gpu_hourly_usd REAL,
      rate_source TEXT,
      status TEXT NOT NULL,
      worker_url TEXT,
      phase TEXT,
      phase_detail TEXT,
      started_at TEXT,
      ready_at TEXT,
      stopped_at TEXT,
      provider_started_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS render_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      asset_id TEXT,
      project_id TEXT,
      production_id TEXT,
      scene_id TEXT,
      model TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      duration_seconds REAL NOT NULL,
      width INTEGER,
      height INTEGER,
      start_frame_path TEXT,
      end_frame_path TEXT,
      prompt TEXT NOT NULL,
      seed INTEGER,
      status TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      parent_job_id TEXT,
      created_at TEXT NOT NULL,
      generation_started_at TEXT,
      generation_completed_at TEXT,
      output_path TEXT,
      duration_actual REAL,
      failure_reason TEXT,
      settings_json TEXT,
      generation_cost_usd REAL,
      cost_status TEXT,
      approved_at TEXT,
      rejected_at TEXT
    );
  `);
}

function ensureVideoAssetColumns(db: Database.Database) {
  if (!columnNames(db, "generated_assets").has("id")) return;
  ensureColumn(db, "generated_assets", "start_frame_asset_id", "TEXT");
  ensureColumn(db, "generated_assets", "end_frame_asset_id", "TEXT");
  ensureColumn(db, "generated_assets", "duration_requested", "REAL");
  ensureColumn(db, "generated_assets", "duration_actual", "REAL");
  ensureColumn(db, "generated_assets", "provider_metadata", "TEXT");
  ensureColumn(db, "generated_assets", "cost_note", "TEXT");
  ensureColumn(db, "generated_assets", "started_at", "TEXT");
}

function recordVerifiedOmniProfile(db: Database.Database) {
  const row = db.prepare(`SELECT allowed_durations FROM production_model_profiles WHERE slug = 'omni-flash'`).get() as { allowed_durations: string } | undefined;
  if (!row || row.allowed_durations !== "unknown") return;
  db.prepare(
    `UPDATE production_model_profiles SET
      allowed_durations = ?,
      start_end_frames = ?,
      audio_support = ?,
      dialogue_support = ?,
      aspect_ratios = ?,
      known_limitations = ?,
      notes = ?
     WHERE slug = 'omni-flash' AND allowed_durations = 'unknown'`,
  ).run(
    "3 to 10 seconds. The API does not accept an exact length.",
    "First and last frame interpolation is supported.",
    "Audio is generated from the prompt. Uploaded audio references are unsupported.",
    "Dialogue can be requested in the prompt.",
    "9:16 and 16:9. 16:9 is the default.",
    "Exact duration cannot be pinned. 1080p and 4k are upscaled. Editing or extending an uploaded video is unavailable in the EEA, Switzerland, and the UK. A scene clip is not the assembled video.",
    "Verified 28 September 2026 from https://ai.google.dev/gemini-api/docs/omni and https://ai.google.dev/gemini-api/docs/pricing. Model gemini-omni-1.1-flash.",
  );
}
