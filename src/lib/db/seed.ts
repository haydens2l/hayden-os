import type Database from "better-sqlite3";
import { ensureProductionDefaults } from "../factory/defaults";
import { migrate } from "./migrate";
import { applyStrategy } from "./strategy";
import { log } from "../log";

const SEED_VERSION = "3";

type Row = Record<string, string | number | null>;

function insert(db: Database.Database, table: string, row: Row) {
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((key) => `@${key}`).join(", ")})`).run(row);
}

export function syncDatabase(db: Database.Database) {
  migrate(db);
  const existing = db.prepare("SELECT value FROM app_meta WHERE key = 'seed_version'").get() as { value: string } | undefined;
  if (existing?.value === SEED_VERSION) return;

  const run = db.transaction(() => {
    if (existing?.value === "1") retireInventedFacts(db);
    else if (existing?.value !== "2") seedStructure(db);
    applyStrategy(db);
    db.prepare(
      `INSERT INTO app_meta (key, value) VALUES ('seed_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(SEED_VERSION);
  });
  run();
  log.info("operating memory synced", { version: SEED_VERSION, previous: existing?.value ?? "none" });
}

function retireInventedFacts(db: Database.Database) {
  const now = new Date().toISOString();
  for (const table of [
    "campaign_metrics",
    "content",
    "tasks",
    "decisions",
    "findings",
    "issues",
    "opportunities",
    "experiments",
    "organisation_metrics",
    "projects",
    "campaigns",
    "priority_assessments",
    "audit_log",
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  db.prepare(
    `UPDATE organisations
     SET pulse_status = NULL,
         interpretation = NULL,
         data_status = 'manual',
         source_type = 'manual',
         source_name = 'Hayden',
         last_updated = ?,
         notes = 'Structure only. No live performance figures are connected.',
         updated_at = ?`,
  ).run(now, now);
  db.prepare(
    `UPDATE people
     SET data_status = 'manual', source_type = 'manual', source_name = 'Hayden', last_updated = ?, updated_at = ?`,
  ).run(now, now);
  db.prepare(`DELETE FROM knowledge`).run();
  seedKnowledge(db, now);
  db.prepare(
    `UPDATE people
     SET notes = CASE id
       WHEN 'hayden' THEN 'Use Hayden for judgement. Do not route routine production here.'
       ELSE 'Directory name from the operating brief. Not a verified live roster.'
     END,
     updated_at = ?`,
  ).run(now);
}

function seedStructure(db: Database.Database) {
  const now = new Date().toISOString();
  const orgs: Array<[string, string | null, string, string, string, number]> = [
    ["finance-engine", null, "Drew / Finance Engine", "business", "The finance group. Inception, WLTH and FIFO Investor sit under it.", 1],
    ["inception", "finance-engine", "Inception Wealth Group", "brand", "Brisbane homeowners. The question to sell is the mortgage-free date.", 2],
    ["wlth", "finance-engine", "WLTH", "brand", "Lending-focused. A profession may change the conversation. Eligibility is never guaranteed.", 3],
    ["fifo", "finance-engine", "FIFO Investor", "brand", "FIFO workers. The emotional outcome is a path out of FIFO.", 4],
    ["media-empire", null, "Media Empire", "business", "Owned media. Brands can be added or archived without changing the system.", 5],
    ["brisbane-collective", "media-empire", "Brisbane Collective", "brand", "Brisbane media brand.", 6],
    ["property-made-simple", "media-empire", "Property Made Simple", "brand", "Property media brand.", 7],
    ["speed-to-lead", null, "Speed to Lead", "business", "Appointment delivery.", 8],
  ];
  for (const [id, parent, name, type, description, sort] of orgs) {
    insert(db, "organisations", {
      id,
      parent_id: parent,
      slug: id,
      name,
      type,
      status: "active",
      description,
      owner: "Hayden Pawelski",
      website: null,
      notes: "Structure only. No live performance figures are connected.",
      sort_order: sort,
      pulse_status: null,
      interpretation: null,
      created_at: now,
      updated_at: now,
      data_status: "manual",
      source_type: "manual",
      source_name: "Hayden",
      source_record: null,
      last_updated: now,
    });
  }

  const people: Array<[string, string, string, string, string, string | null]> = [
    ["hayden", "finance-engine", "Hayden Pawelski", "Founder", "Direction, creative calls, relationships, capital, offers.", null],
    ["drew", "finance-engine", "Drew", "Finance engine lead", "Campaign numbers and what the finance brands are waiting on.", "hayden"],
    ["lily", "media-empire", "Lily", "Delivery and production", "Content production and Speed to Lead delivery.", "hayden"],
  ];
  for (const [id, org, name, role, responsibilities, manager] of people) {
    insert(db, "people", {
      id,
      organisation_id: org,
      name,
      role,
      responsibilities,
      manager_id: manager,
      contact_information: null,
      status: "active",
      notes: id === "hayden" ? "Use Hayden for judgement. Do not route routine production here." : "Directory name from the operating brief. Not a verified live roster.",
      created_at: now,
      updated_at: now,
      data_status: "manual",
      source_type: "manual",
      source_name: "Hayden",
      source_record: null,
      last_updated: now,
    });
  }

  seedKnowledge(db, now);
  seedPlaceholders(db, now);
}

function seedKnowledge(db: Database.Database, now: string) {
  const notes: Array<[string, string | null, string, string, string]> = [
    ["know-attention", null, "operating", "What Hayden is for", "Hayden is for direction, major creative decisions, relationships, capital, hiring, commercial calls, partnerships, new ventures and offer direction. He is not the route for CRM cleanup, chasing leads, formatting, routine production, reminders or data entry."],
    ["know-inception", "inception", "positioning", "Inception mortgage-free date", "Positioning note from Hayden: Inception ads should open on the mortgage-free date, not on refinancing or an investment property. This is guidance, not a measured result."],
    ["know-fifo", "fifo", "positioning", "FIFO message", "Positioning note from Hayden: the emotional goal is a path toward not needing FIFO. Do not promise tax savings. Do not attack property."],
    ["know-wlth", "wlth", "positioning", "WLTH claim boundary", "Positioning note from Hayden: WLTH can ask whether a profession might open a higher-LVR conversation. Never imply everyone qualifies. Never guarantee 95% LVR or no LMI."],
  ];
  for (const [id, org, category, title, content] of notes) {
    insert(db, "knowledge", {
      id,
      organisation_id: org,
      category,
      title,
      content,
      source: "Hayden",
      confidence: "high",
      last_verified: now.slice(0, 10),
      created_at: now,
      updated_at: now,
      data_status: "manual",
      source_type: "hayden",
      source_name: "Hayden",
      source_record: null,
      last_updated: now,
    });
  }
}

function seedPlaceholders(db: Database.Database, now: string) {
  const agents: Array<[string, string, string, string | null, string]> = [
    ["chief-of-staff", "Chief of Staff", "Protect Hayden's time. Route specialist work. Summarise agent output. Cannot send, publish, spend, delete, or change CRM records.", null, "active"],
    ["growth", "Growth Strategist", "Own commercial growth logic: offers, funnels, acquisition and experiments. No live data means no performance claim. Cannot launch campaigns or spend.", "finance-engine", "active"],
    ["creative", "Creative Director", "Own creative thinking across advertising and owned media. Produce concepts, hooks and scripts. A concept is not a finished video. Cannot publish or spend.", "finance-engine", "active"],
    ["content", "Content Factory", "AI Production Director. Convert an approved concept into production instructions. A pack is not a finished video. Cannot publish, send, or spend.", "media-empire", "active"],
    ["media", "Media Director", "Build owned audience and repeatable formats for Media Empire, Property Made Simple and Brisbane Collective. Cannot publish.", "media-empire", "active"],
    ["sales", "Sales Director", "Show rate, objections and pipeline leakage.", "finance-engine", "placeholder"],
    ["revops", "RevOps", "CRM health, stale leads and SLA breaches.", "speed-to-lead", "placeholder"],
    ["cfo", "CFO", "Revenue, margin, cash and acquisition economics.", null, "placeholder"],
    ["bdm", "BDM", "Partners, sponsors and outreach worth making.", "media-empire", "placeholder"],
    ["research", "Research", "Competitors, offers and market shifts worth a look.", null, "placeholder"],
  ];
  for (const [slug, name, mandate, organisationId, status] of agents) {
    insert(db, "agents", {
      id: slug,
      slug,
      name,
      mandate,
      organisation_id: organisationId,
      status,
      created_at: now,
    });
  }

  const permissions: Array<[string, string, string, number, string | null]> = [
    ["chief-of-staff", "*", "READ", 0, "Can read the whole operating memory."],
    ["chief-of-staff", "tasks", "CREATE", 0, "Can draft tasks for other people."],
    ["chief-of-staff", "attention", "ESCALATE", 0, "Can place a justified item on Hayden's list."],
    ["chief-of-staff", "spend", "EXECUTE", 1, "Cannot spend."],
    ["chief-of-staff", "findings", "CREATE", 0, "May create an internal finding. Cannot delete records."],
    ["chief-of-staff", "opportunities", "CREATE", 0, "May create an internal opportunity. Cannot launch or spend."],
    ["creative", "*", "READ", 0, "Can read shared operating memory."],
    ["creative", "creative_concepts", "CREATE", 0, "Can store concepts in the creative library."],
    ["creative", "publish_content", "EXECUTE", 1, "Cannot publish."],
    ["growth", "*", "READ", 0, "Can read shared operating memory."],
    ["growth", "experiments", "CREATE", 0, "May propose an experiment. Cannot mark it successful."],
    ["growth", "launch_campaign", "EXECUTE", 1, "Cannot launch or spend."],
    ["growth", "publish_content", "EXECUTE", 1, "Cannot publish."],
    ["media", "*", "READ", 0, "Can read shared operating memory."],
    ["media", "media_formats", "CREATE", 0, "May store a format as an idea."],
    ["media", "publish_content", "EXECUTE", 1, "Cannot publish."],
    ["content", "*", "READ", 0, "Can read shared operating memory."],
    ["content", "production_packs", "CREATE", 0, "Can store a production pack. A pack is not a finished asset."],
    ["content", "publish_content", "EXECUTE", 1, "Cannot publish."],
    ["content", "spend", "EXECUTE", 1, "Cannot spend."],
    ["revops", "delete_records", "EXECUTE", 1, "Cannot delete records."],
    ["cfo", "change_financials", "UPDATE", 1, "Financial changes need a person."],
    ["bdm", "mass_outreach", "EXECUTE", 1, "Mass outreach needs a person."],
  ];
  permissions.forEach(([agentId, resource, level, approval, notes], index) => {
    insert(db, "agent_permissions", {
      id: `perm-${index + 1}`,
      agent_id: agentId,
      resource,
      level,
      requires_approval: approval,
      notes,
    });
  });

  const integrations: Array<[string, string, string]> = [
    ["google-drive", "Google Drive", "Read-only. Indexes only the folders you approve."],
    ["google-calendar", "Google Calendar", "Meetings and deadlines."],
    ["meta-ads", "Meta Ads", "Spend and campaign results."],
    ["crm", "CRM", "Leads, stages and follow-up."],
    ["aircall", "Aircall", "Call activity."],
    ["metricool", "Metricool", "Owned-media performance."],
    ["accounting", "Accounting", "Revenue, costs and cash."],
    ["web-research", "Web research", "Public market checks."],
    ["media-generation", "Image and video generation", "Production assets after a concept is approved."],
  ];
  for (const [slug, name, notes] of integrations) {
    insert(db, "integrations", { id: slug, slug, name, status: "disconnected", notes });
  }
  ensureProductionDefaults(db);
}
