import type Database from "better-sqlite3";
import { brisbaneToday } from "@/lib/dates";
import { decidePermission } from "@/lib/permissions-decision";
import { operatingContext } from "@/lib/team/context";
import { asText, draft, parseModelJson } from "@/lib/team/draft";
import { runContentFactory } from "@/lib/factory/run";
import { blockedAction, organisationFor, requestedCount } from "@/lib/team/route";
import { runVisualDirector } from "@/lib/visual/director";
import { lockIntent } from "@/lib/visual/intent";

export type AgentJob = {
  id: string;
  agent_id: string;
  title: string;
  objective: string;
  organisation_id: string | null;
  project_id: string | null;
  requested_by: string;
  requested_by_label: string | null;
  status: string;
  priority: string | null;
  input_context: string | null;
  output_summary: string | null;
  findings: string | null;
  recommendations: string | null;
  tasks_created: string | null;
  decisions_created: string | null;
  evidence: string | null;
  confidence: string | null;
  started_at: string | null;
  completed_at: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  parent_job_id: string | null;
  created_at: string;
};

const NO_LIVE = "We don't currently have live campaign performance data.";

export async function assignAndRun(
  db: Database.Database,
  input: {
    agentId: string;
    objective: string;
    requestedBy: string;
    requestedByLabel?: string;
    title?: string;
    parentJobId?: string | null;
    reuse?: boolean;
  },
) {
  const objective = input.objective.trim();
  if (!objective) throw new Error("The assignment needs an objective.");
  if (input.reuse) {
    const recent = recentJob(db, input.agentId, objective, input.requestedBy);
    if (recent) return recent;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const organisationId = organisationFor(objective);
  db.prepare(
    `INSERT INTO agent_jobs (
      id, agent_id, title, objective, organisation_id, requested_by, requested_by_label, status, priority,
      parent_job_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'normal', ?, ?)`,
  ).run(
    id,
    input.agentId,
    input.title?.trim() || objective.slice(0, 140),
    objective,
    organisationId,
    input.requestedBy,
    input.requestedByLabel ?? labelFor(db, input.requestedBy),
    input.parentJobId ?? null,
    now,
  );
  return executeJob(db, id);
}

export async function executeJob(db: Database.Database, jobId: string) {
  const job = mustJob(db, jobId);
  const started = new Date().toISOString();
  db.prepare(`UPDATE agent_jobs SET status = 'working', started_at = ? WHERE id = ?`).run(started, jobId);
  const blocked = blockedAction(job.objective);
  if (blocked) {
    const decision = decidePermission(db, job.agent_id, "EXECUTE", blocked);
    return finish(db, jobId, {
      status: "cancelled",
      summary: decision.needsApproval
        ? `${agentName(db, job.agent_id)} cannot ${blocked.replaceAll("_", " ")}. That needs Hayden's approval, and it has not been given.`
        : decision.reason,
      findings: "Blocked by permissions.",
      recommendations: "Leave the action with Hayden.",
      confidence: "high",
      evidence: decision.reason,
      model: null,
      inputTokens: null,
      outputTokens: null,
    });
  }
  const context = operatingContext(db, job.objective, job.organisation_id);
  db.prepare(`UPDATE agent_jobs SET input_context = ? WHERE id = ?`).run(context.text, jobId);
  const result =
    job.agent_id === "creative"
      ? await runCreative(db, job, context)
      : job.agent_id === "growth"
        ? await runGrowth(db, job, context)
        : job.agent_id === "media"
          ? await runMedia(db, job, context)
          : job.agent_id === "content"
            ? await runContentFactory(db, job, context)
            : job.agent_id === "visual"
              ? await runVisualJob(db, job)
              : {
              summary: "That seat is not built.",
              findings: "No specialist ran.",
              recommendations: "Choose Creative Director, Growth Strategist, Media Director, or Content Factory.",
              confidence: "high",
              evidence: "Agent status",
              model: null,
              inputTokens: null,
              outputTokens: null,
            };
  return finish(db, jobId, { status: "complete", ...result });
}

async function runVisualJob(db: Database.Database, job: { id: string; objective: string }) {
  const named = /concept:([0-9a-f-]{16,})/i.exec(job.objective)?.[1];
  const latest = named
    ? named
    : (db.prepare(`SELECT id FROM creative_concepts WHERE status = 'approved' ORDER BY approved_at DESC LIMIT 1`).get() as { id: string } | undefined)?.id;
  if (!latest) {
    return {
      summary: "Visual Director needs an approved concept.",
      findings: "No approved concept is stored.",
      recommendations: "Approve a concept, then ask for visual direction.",
      confidence: "high",
      evidence: "creative_concepts",
      model: null,
      inputTokens: null,
      outputTokens: null,
      requiresHayden: false,
    };
  }
  lockIntent(db, latest);
  return runVisualDirector(db, latest, job.id);
}

export async function requestHandoff(
  db: Database.Database,
  input: { fromAgentId: string; toAgentId: string; objective: string; fromJobId?: string | null },
) {
  const handoffId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const job = await assignAndRun(db, {
    agentId: input.toAgentId,
    objective: input.objective,
    requestedBy: input.fromAgentId,
    requestedByLabel: agentName(db, input.fromAgentId),
    parentJobId: input.fromJobId ?? null,
  });
  db.prepare(
    `INSERT INTO agent_handoffs (id, from_agent_id, to_agent_id, from_job_id, to_job_id, objective, requested_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(handoffId, input.fromAgentId, input.toAgentId, input.fromJobId ?? null, job.id, input.objective, input.fromAgentId, createdAt);
  return { handoffId, job };
}

export function setConceptStatus(
  db: Database.Database,
  id: string,
  status: "idea" | "shortlisted" | "approved" | "rejected" | "archived" | "changes_requested",
  note?: string,
) {
  const now = new Date().toISOString();
  if (status === "approved") {
    db.prepare(`UPDATE creative_concepts SET status = 'approved', approved_at = ?, approved_by = 'hayden' WHERE id = ?`).run(now, id);
    lockIntent(db, id);
    return;
  }
  if (status === "changes_requested") {
    const current = db.prepare(`SELECT notes FROM creative_concepts WHERE id = ?`).get(id) as { notes: string | null } | undefined;
    const detail = note?.trim() ? `Hayden requested changes. ${note.trim()}` : "Hayden requested changes. No detail stored yet.";
    const notes = [current?.notes, detail].filter(Boolean).join("\n");
    db.prepare(`UPDATE creative_concepts SET status = 'changes_requested', notes = ?, approved_at = NULL, approved_by = NULL WHERE id = ?`).run(notes, id);
    return;
  }
  db.prepare(`UPDATE creative_concepts SET status = ?, approved_at = NULL, approved_by = NULL WHERE id = ?`).run(status, id);
}

export function listJobs(db: Database.Database, agentId: string) {
  return db.prepare(`SELECT * FROM agent_jobs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 30`).all(agentId) as AgentJob[];
}

export function listConcepts(db: Database.Database, organisationId?: string | null) {
  if (organisationId) {
    return db.prepare(`SELECT * FROM creative_concepts WHERE organisation_id = ? ORDER BY created_at DESC LIMIT 40`).all(organisationId) as ConceptRow[];
  }
  return db.prepare(`SELECT * FROM creative_concepts ORDER BY created_at DESC LIMIT 40`).all() as ConceptRow[];
}

export function listFormats(db: Database.Database) {
  return db.prepare(`SELECT * FROM media_formats ORDER BY created_at DESC LIMIT 40`).all() as FormatRow[];
}

export function usageTotals(db: Database.Database) {
  const rows = db.prepare(`SELECT completed_at, input_tokens, output_tokens FROM agent_jobs WHERE completed_at IS NOT NULL`).all() as Array<{
    completed_at: string;
    input_tokens: number | null;
    output_tokens: number | null;
  }>;
  const today = brisbaneToday();
  const month = today.slice(0, 7);
  const blank = { input: 0, output: 0, runs: 0 };
  const totals = { today: { ...blank }, month: { ...blank } };
  for (const row of rows) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.completed_at));
    const bucket = day === today ? totals.today : null;
    const monthBucket = day.slice(0, 7) === month ? totals.month : null;
    for (const target of [bucket, monthBucket]) {
      if (!target) continue;
      target.runs += 1;
      target.input += row.input_tokens ?? 0;
      target.output += row.output_tokens ?? 0;
    }
  }
  return totals;
}

export function teamBoard(db: Database.Database) {
  const agents = db.prepare(`SELECT id, name, mandate, status FROM agents ORDER BY created_at`).all() as Array<{
    id: string;
    name: string;
    mandate: string;
    status: string;
  }>;
  const order = ["chief-of-staff", "creative", "visual", "growth", "media", "content", "sales", "revops", "cfo", "research", "bdm"];
  return agents
    .slice()
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((agent) => {
      const jobs = listJobs(db, agent.id);
      const latest = jobs[0];
      let seat = "IDLE";
      if (agent.status !== "active") seat = "NOT BUILT";
      else if (latest?.status === "failed") seat = "ERROR";
      else if (latest?.status === "working") seat = "WORKING";
      else if (latest?.status === "needs_approval") seat = "NEEDS HAYDEN";
      else if (latest?.status === "waiting" || latest?.status === "queued") seat = "WAITING";
      return {
        id: agent.id,
        name: agent.name,
        role: agent.mandate,
        seat,
        assignment: latest && ["queued", "working", "waiting", "needs_approval"].includes(latest.status) ? latest.title : "None",
        lastRun: jobs.find((job) => job.completed_at)?.completed_at ?? null,
        finding: latest?.output_summary ?? "None yet",
        waitingOn: latest?.status === "needs_approval" ? "Hayden" : "Nobody",
        runCost: formatCost(jobs.find((job) => job.input_tokens != null || job.output_tokens != null) ?? latest),
      };
    });
}

export function noticesForJob(db: Database.Database, jobId: string) {
  return db.prepare(`SELECT * FROM agent_notices WHERE job_id = ?`).all(jobId) as Array<{ id: string; summary: string; requires_hayden: number }>;
}

type ConceptRow = {
  id: string;
  title: string;
  brand: string | null;
  hook: string | null;
  status: string;
  concept: string | null;
  format: string | null;
  organisation_id: string | null;
};

type FormatRow = {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  status: string;
  repeatability_score: number | null;
};

type SpecialistBody = {
  summary: string;
  findings: string;
  recommendations: string;
  confidence: string;
  evidence: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  requiresHayden?: boolean;
};

async function runCreative(
  db: Database.Database,
  job: AgentJob,
  context: { text: string; organisationName: string | null; brainTitles: string[] },
): Promise<SpecialistBody> {
  const lowerObjective = job.objective.toLowerCase();
  const asksForMetric = /\bcpl\b|cost per lead|\broas\b/.test(lowerObjective);
  const asksForFigure = /what(?:'s| is)|current|yesterday|how (?:did|is|much)/.test(lowerObjective);
  const forbidsInvention = /do not invent|don't invent|never invent/.test(lowerObjective);
  if (asksForMetric && asksForFigure && !forbidsInvention) {
    return {
      summary: "No live CPL is stored. Creative Director does not invent acquisition cost, and Growth cannot see a live figure until a campaign source is connected.",
      findings: NO_LIVE,
      recommendations: "Ask again when a live source is connected.",
      confidence: "high",
      evidence: context.brainTitles.join(", ") || "No performance record",
      model: null,
      inputTokens: null,
      outputTokens: null,
    };
  }
  if (/pipeline|not using|already done/.test(job.objective.toLowerCase())) {
    const rows = listConcepts(db, job.organisation_id);
    const summary = rows.length === 0 ? "The creative library is empty." : `${rows.length} stored concepts. Statuses stay as saved. Nothing here is a published result.`;
    return {
      summary,
      findings: rows.map((row) => `${row.status}: ${row.title}`).join("\n") || "None",
      recommendations: "Shortlist the ones worth a production brief.",
      confidence: "high",
      evidence: "creative_concepts",
      model: null,
      inputTokens: null,
      outputTokens: null,
    };
  }
  const count = requestedCount(job.objective, 5);
  const brand = context.organisationName ?? "UNKNOWN BRAND";
  const drafted = await draft(
    `You are the Creative Director inside Hayden OS. You create concepts, not finished videos or ads. Use only the operating context for the named brand. Do not import another brand's audience, characters, or setting. Do not invent metrics, CPL, or published results. Prefer entertainment, story, comedy, tension, surprise, characters, visual metaphor and comparison over dry finance education. Australian context only where the notes support it. Return JSON only: {"concepts":[{"title","objective","audience","hook","coreIdea","format","script","visual","why","cta","complexity","variations","nextAction"}]} with exactly ${count} concepts.`,
    `Request: ${job.objective}\n\n${context.text}`,
    0.6,
    count >= 8 ? 240000 : 90000,
  );
  const parsed = drafted.ok ? parseModelJson(drafted.text) : null;
  const incoming = Array.isArray(parsed?.concepts) ? parsed.concepts : [];
  const concepts = incoming.slice(0, count).map((item) => normaliseConcept(item, brand)).filter((concept) => concept.title && concept.hook);
  if (concepts.length === 0) {
    return {
      summary: drafted.ok
        ? "The model replied, but it did not return concepts that could be stored. Nothing was added to the library."
        : "The model did not respond. No concepts were stored.",
      findings: drafted.message ? `No concept stored. ${drafted.message}` : "No concept stored.",
      recommendations: "Try the request again.",
      confidence: "low",
      evidence: context.brainTitles.join(", ") || "No brand note matched",
      model: drafted.model,
      inputTokens: drafted.inputTokens,
      outputTokens: drafted.outputTokens,
    };
  }
  const now = new Date().toISOString();
  const status = job.requested_by === "hayden" ? "shortlisted" : "idea";
  const insert = db.prepare(
    `INSERT INTO creative_concepts (
      id, organisation_id, brand, title, concept, hook, format, objective, audience, script_outline, visual_direction,
      why_it_may_work, cta, production_complexity, variations, next_action, status, created_by, created_at, production_status, job_id, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creative', ?, 'concept_only', ?, ?)`,
  );
  for (const concept of concepts) {
    insert.run(
      crypto.randomUUID(),
      job.organisation_id,
      brand,
      concept.title,
      concept.coreIdea,
      concept.hook,
      concept.format,
      concept.objective,
      concept.audience,
      concept.script,
      concept.visual,
      concept.why,
      concept.cta,
      concept.complexity,
      concept.variations,
      concept.nextAction,
      status,
      now,
      job.id,
      concepts.length < count ? "The model returned a short set. Missing concepts were not invented." : "Concept only. Not produced or published.",
    );
  }
  const summary = status === "shortlisted"
    ? `${agentName(db, "creative")} prepared ${concepts.length} concepts for ${brand}. They are saved for you to approve. Nothing has been produced.`
    : `${agentName(db, "creative")} prepared ${concepts.length} concepts for ${brand}. These are concepts, not produced files.`;
  return {
    summary,
    findings: concepts.map((concept, index) => `${index + 1}. ${concept.title}. ${concept.hook}`).join("\n"),
    recommendations: "Hayden can shortlist or approve. Lily can execute production after approval. Danny's creative-direction role is still a hypothesis.",
    confidence: context.brainTitles.length > 0 ? "medium" : "low",
    evidence: context.brainTitles.join(", ") || "No brand note matched",
    model: drafted.model,
    inputTokens: drafted.inputTokens,
    outputTokens: drafted.outputTokens,
  };
}

async function runGrowth(
  db: Database.Database,
  job: AgentJob,
  context: { text: string; organisationName: string | null; brainTitles: string[] },
): Promise<SpecialistBody> {
  const drafted = await draft(
    `You are the Growth Strategist inside Hayden OS. No data means no performance claim. Never invent CPL, ROAS, spend, or conversion rates. Strategy is allowed. Return JSON only: {"observation","opportunity","hypothesis","test","expectedImpact","measurement","dependencies","owner","haydenRequired","liveData"}`,
    `Request: ${job.objective}\n\n${context.text}\n\n${NO_LIVE}`,
    0.3,
  );
  const parsed = drafted.ok ? parseModelJson(drafted.text) : null;
  const observation = asText(parsed?.observation, "No live performance figure is available to observe.");
  const opportunity = asText(parsed?.opportunity, job.objective);
  const hypothesis = asText(parsed?.hypothesis, "A clearer acquisition question may earn more relevant attention. This is a hypothesis, not a result.");
  const test = asText(parsed?.test, "Define the test once a live source exists.");
  const measurement = asText(parsed?.measurement, "To be defined once live campaign data exists.");
  const owner = asText(parsed?.owner, "Hayden for the commercial call. No media buyer is assigned here.");
  const haydenRequired = parsed?.haydenRequired === true;
  const liveData = NO_LIVE;
  const experimentId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO experiments (id, organisation_id, name, hypothesis, variable, status, learning, data_status, source_type, source_name, last_updated)
     VALUES (?, ?, ?, ?, ?, 'proposed', ?, 'manual', 'agent', 'Growth Strategist', ?)`,
  ).run(experimentId, job.organisation_id, job.title.slice(0, 120), hypothesis, test, "No outcome is stored. The experiment is proposed, not successful.", new Date().toISOString());
  return {
    summary: `${liveData} ${observation}`.trim(),
    findings: `Observation: ${observation}\nOpportunity: ${opportunity}\nHypothesis: ${hypothesis}`,
    recommendations: `Test: ${test}\nExpected impact: ${asText(parsed?.expectedImpact, "Unknown until measured.")}\nMeasurement: ${measurement}\nDependencies: ${asText(parsed?.dependencies, "A live campaign source.")}\nOwner: ${owner}\nHayden required: ${haydenRequired ? "Yes" : "Not for this note."}`,
    confidence: "low",
    evidence: context.brainTitles.join(", ") || NO_LIVE,
    model: drafted.model,
    inputTokens: drafted.inputTokens,
    outputTokens: drafted.outputTokens,
  };
}

async function runMedia(
  db: Database.Database,
  job: AgentJob,
  context: { text: string; organisationName: string | null; brainTitles: string[] },
): Promise<SpecialistBody> {
  const drafted = await draft(
    `You are the Media Director inside Hayden OS. Think like a media company: repeatable formats, accumulated audience, recognisable IP, and possible monetisation. Do not plan a single post. Do not mark a format as active or successful. Do not invent audience size or revenue. Return JSON only: {"observation","opportunity","formats":[{"name","description","pillar","repeatability","complexity","commercial","why","distribution","monetisation","nextTest"}]} with 3 formats.`,
    `Request: ${job.objective}\n\n${context.text}`,
    0.5,
  );
  const parsed = drafted.ok ? parseModelJson(drafted.text) : null;
  const incoming = Array.isArray(parsed?.formats) ? parsed.formats : [];
  const formats = (incoming.length > 0 ? incoming : fallbackFormats(context.organisationName)).slice(0, 4);
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO media_formats (
      id, organisation_id, name, brand, description, content_pillar, repeatability_score, production_complexity,
      commercial_relevance, status, created_by, notes, created_at, job_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idea', 'media', ?, ?, ?)`,
  );
  const lines: string[] = [];
  for (const item of formats) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const name = asText(record.name, "Untitled format");
    const score = Number(record.repeatability);
    insert.run(
      crypto.randomUUID(),
      job.organisation_id,
      name,
      context.organisationName,
      asText(record.description),
      asText(record.pillar),
      Number.isFinite(score) ? Math.min(5, Math.max(1, score)) : null,
      asText(record.complexity),
      asText(record.commercial),
      `Why: ${asText(record.why)} Distribution: ${asText(record.distribution)} Monetisation: ${asText(record.monetisation)} Next test: ${asText(record.nextTest)} Status is idea, not an active show.`,
      now,
      job.id,
    );
    lines.push(name);
  }
  return {
    summary: `${asText(parsed?.observation, "The useful question is which format could repeat, not what to post once.")} ${asText(parsed?.opportunity, "")}`.trim(),
    findings: lines.map((name) => `Idea: ${name}`).join("\n"),
    recommendations: "Keep these as ideas. A format becomes active only after Hayden says so.",
    confidence: context.brainTitles.length > 0 ? "medium" : "low",
    evidence: context.brainTitles.join(", ") || "Stored brand notes",
    model: drafted.model,
    inputTokens: drafted.inputTokens,
    outputTokens: drafted.outputTokens,
  };
}

function fallbackFormats(brand: string | null) {
  const name = brand ?? "This brand";
  return [
    { name: `${name} conversation series`, description: "A repeatable conversation format drawn from the stored brand notes.", pillar: "Audience", repeatability: 4, complexity: "Low", commercial: "Possible later", why: "Stored notes favour audience over a one-off post.", distribution: "Owned channels", monetisation: "None selected", nextTest: "Define the episode shape before production." },
  ];
}

function normaliseConcept(value: unknown, brand: string) {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    title: asText(item.title, `${brand} concept`),
    objective: asText(item.objective),
    audience: asText(item.audience),
    hook: asText(item.hook),
    coreIdea: asText(item.coreIdea),
    format: asText(item.format, "Short video"),
    script: asText(item.script),
    visual: asText(item.visual),
    why: asText(item.why),
    cta: asText(item.cta),
    complexity: asText(item.complexity),
    variations: asText(item.variations),
    nextAction: asText(item.nextAction, "Shortlist before any production."),
  };
}

function finish(
  db: Database.Database,
  jobId: string,
  result: SpecialistBody & { status: string },
) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agent_jobs
     SET status = ?, output_summary = ?, findings = ?, recommendations = ?, evidence = ?, confidence = ?,
         completed_at = ?, model = ?, input_tokens = ?, output_tokens = ?, tasks_created = '[]', decisions_created = '[]'
     WHERE id = ?`,
  ).run(
    result.status,
    result.summary,
    result.findings,
    result.recommendations,
    result.evidence,
    result.confidence,
    now,
    result.model,
    result.inputTokens,
    result.outputTokens,
    jobId,
  );
  const job = mustJob(db, jobId);
  const conceptCount = db.prepare(`SELECT COUNT(*) AS n FROM creative_concepts WHERE job_id = ?`).get(jobId) as { n: number };
  const summary =
    conceptCount.n > 1
      ? `Creative Director has prepared ${conceptCount.n} concepts. They stay in the library until you shortlist them.`
      : result.summary;
  db.prepare(`INSERT INTO agent_notices (id, agent_id, job_id, summary, requires_hayden, created_at) VALUES (?, 'chief-of-staff', ?, ?, ?, ?)`).run(
    crypto.randomUUID(),
    jobId,
    summary,
    result.requiresHayden ? 1 : 0,
    now,
  );
  db.prepare(
    `INSERT INTO audit_log (id, agent, created_at, evidence, reasoning, recommendation, confidence, actions_taken, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agent_job', ?)`,
  ).run(crypto.randomUUID(), job.agent_id, now, result.evidence, result.findings, result.recommendations, result.confidence, result.status, jobId);
  return job;
}

function recentJob(db: Database.Database, agentId: string, objective: string, requestedBy: string) {
  return db
    .prepare(
      `SELECT * FROM agent_jobs
       WHERE agent_id = ? AND objective = ? AND requested_by = ? AND status = 'complete'
         AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(agentId, objective, requestedBy, new Date(Date.now() - 15 * 60 * 1000).toISOString()) as AgentJob | undefined;
}

function mustJob(db: Database.Database, id: string) {
  const job = db.prepare(`SELECT * FROM agent_jobs WHERE id = ?`).get(id) as AgentJob | undefined;
  if (!job) throw new Error("That agent job is not stored.");
  return job;
}

function agentName(db: Database.Database, id: string) {
  if (id === "hayden") return "Hayden";
  const row = db.prepare(`SELECT name FROM agents WHERE id = ?`).get(id) as { name: string } | undefined;
  return row?.name ?? id;
}

function labelFor(db: Database.Database, id: string) {
  return agentName(db, id);
}

function formatCost(job: AgentJob | undefined) {
  if (!job || (job.input_tokens == null && job.output_tokens == null)) return "No usage recorded";
  return `${job.input_tokens ?? 0} in / ${job.output_tokens ?? 0} out`;
}
