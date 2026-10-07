import type Database from "better-sqlite3";
import { asText, draft, parseModelJson } from "@/lib/team/draft";
import { organisationFor, suggestAgent } from "@/lib/team/route";
import type { CommandAnswer } from "@/lib/command/answer";
import { requestHandoff, setConceptStatus } from "@/lib/team/work";

const PERFORMANCE = /\bcpl\b|cost per lead|\broas\b|engagement rate|went viral|previous winner|top performer/i;

export async function coordinateBroadRequest(db: Database.Database, query: string): Promise<CommandAnswer> {
  const suggestion = suggestAgent(query);
  const target = suggestion.id === "creative" || suggestion.id === "growth" || suggestion.id === "media" ? suggestion.id : "creative";
  const organisationId = organisationFor(query);
  const now = new Date().toISOString();
  const chiefId = crypto.randomUUID();
  const routing =
    target === "creative"
      ? "This is a creative problem. Creative Director will develop the concepts. Media Director was not asked: this is one video, not a new format or series. Growth was not asked: no live performance data is connected, and this is not a funnel question. Content Factory waits until Hayden approves a concept."
      : `${suggestion.name} should handle it. ${suggestion.reason}`;
  db.prepare(
    `INSERT INTO agent_jobs (
      id, agent_id, title, objective, organisation_id, requested_by, requested_by_label, status, priority,
      input_context, output_summary, findings, recommendations, tasks_created, decisions_created, evidence, confidence,
      started_at, completed_at, created_at
    ) VALUES (?, 'chief-of-staff', ?, ?, ?, 'hayden', 'Hayden', 'complete', 'normal', ?, ?, ?, ?, '[]', '[]', ?, 'high', ?, ?, ?)`,
  ).run(
    chiefId,
    "Route a broad request",
    query,
    organisationId,
    query,
    routing,
    "No specialist has run yet.",
    "Come back to Hayden with a short list, not the full pile.",
    "Chief of Staff routing. No performance data was used.",
    now,
    now,
    now,
  );

  const creativeObjective = `Give me 10 Property Made Simple video concepts about paying a home mortgage off faster. Entertainment first: story, comedy, tension, surprise, characters, visual metaphor or comparison. Not a dry finance explanation. Not rent. No personalised financial advice. Do not invent performance figures or past winners. Each concept needs a hook and a core idea that can be explained in about 30 seconds. Do not aim phones, documents, payslips, calculators or statements at the camera. No automatic logos. No speech bubbles. Hayden's request: ${query}`;
  const handoff = await requestHandoff(db, {
    fromAgentId: "chief-of-staff",
    toAgentId: target,
    objective: target === "creative" ? creativeObjective : query,
    fromJobId: chiefId,
  });
  if (target !== "creative") {
    return {
      heading: "Chief of Staff",
      summary: routing,
      items: [],
    };
  }

  const concepts = db
    .prepare(
      `SELECT id, title, hook, concept, format, why_it_may_work, production_complexity, script_outline
       FROM creative_concepts WHERE job_id = ? ORDER BY created_at`,
    )
    .all(handoff.job.id) as Array<{
    id: string;
    title: string;
    hook: string | null;
    concept: string | null;
    format: string | null;
    why_it_may_work: string | null;
    production_complexity: string | null;
    script_outline: string | null;
  }>;
  const usable = concepts.filter((concept) => !PERFORMANCE.test(`${concept.why_it_may_work ?? ""} ${concept.concept ?? ""}`));
  const picks = await chooseThree(usable);
  for (const pick of picks) {
    setConceptStatus(db, pick.id, "shortlisted");
    db.prepare(`UPDATE creative_concepts SET notes = ? WHERE id = ?`).run(`Shortlist: ${pick.reason}`, pick.id);
  }
  const summary =
    picks.length > 0
      ? `Creative Director prepared ${concepts.length} concepts. ${picks.length} are ready for your review. The rest stay in the library and are not on your list. Nothing is approved. Content Factory has not been asked.`
      : "Creative Director did not return a set that could be shortlisted. Nothing was approved.";
  db.prepare(
    `UPDATE agent_jobs SET findings = ?, recommendations = ?, output_summary = ? WHERE id = ?`,
  ).run(
    picks.map((pick, index) => `${index + 1}. ${pick.title}. ${pick.reason}`).join("\n") || "No shortlist.",
    "Hayden chooses approve, changes, or reject. Approval does not start production.",
    summary,
    chiefId,
  );
  db.prepare(
    `INSERT INTO agent_notices (id, agent_id, job_id, summary, requires_hayden, created_at) VALUES (?, 'chief-of-staff', ?, ?, 1, ?)`,
  ).run(crypto.randomUUID(), chiefId, summary, new Date().toISOString());
  db.prepare(
    `INSERT INTO audit_log (id, agent, created_at, evidence, reasoning, recommendation, confidence, actions_taken, entity_type, entity_id)
     VALUES (?, 'chief-of-staff', ?, ?, ?, ?, 'high', 'routed', 'agent_job', ?)`,
  ).run(crypto.randomUUID(), new Date().toISOString(), "Creative judgement. No performance evidence.", routing, "Shortlist only. No approval.", chiefId);

  return {
    heading: "Chief of Staff",
    summary,
    items: [],
  };
}

async function chooseThree(
  concepts: Array<{ id: string; title: string; hook: string | null; concept: string | null; format: string | null }>,
) {
  if (concepts.length === 0) return [];
  const listed = concepts
    .map((concept, index) => `${index + 1}. ${concept.title}\nHook: ${concept.hook ?? ""}\nIdea: ${concept.concept ?? ""}\nFormat: ${concept.format ?? ""}`)
    .join("\n\n");
  const drafted = await draft(
    `You are choosing a shortlist for Hayden. Pick the strongest 3 concepts from the list. Use creative judgement only: entertainment, story, character, surprise, and fit with an entertainment-first property brand. Do not mention CPL, engagement, results, or past winners. No live performance data exists. Return JSON only: {"picks":[{"title":"exact title","reason":"one or two sentences of creative reasoning"}]} with exactly 3 picks. Titles must match the list.`,
    listed,
    0.2,
    60000,
  );
  const parsed = drafted.ok ? parseModelJson(drafted.text) : null;
  const incoming = Array.isArray(parsed?.picks) ? parsed.picks : [];
  const chosen: Array<{ id: string; title: string; reason: string }> = [];
  const used = new Set<string>();
  for (const item of incoming) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const title = asText(record.title);
    const match = concepts.find((concept) => {
      if (used.has(concept.id)) return false;
      const left = concept.title.toLowerCase();
      const right = title.toLowerCase();
      return left === right || left.includes(right) || right.includes(left);
    });
    if (!match) continue;
    const reason = asText(record.reason, "Stronger entertainment and a clearer character than the concepts left in the library.");
    if (PERFORMANCE.test(reason)) continue;
    used.add(match.id);
    chosen.push({ id: match.id, title: match.title, reason });
    if (chosen.length === 3) break;
  }
  return chosen;
}

export function shortlistedForReview(db: Database.Database) {
  return db
    .prepare(
      `SELECT id, brand, title, hook, concept, script_outline, format, why_it_may_work, production_complexity, notes, status, approved_by
       FROM creative_concepts WHERE status = 'shortlisted' ORDER BY created_at DESC`,
    )
    .all() as Array<{
    id: string;
    brand: string | null;
    title: string;
    hook: string | null;
    concept: string | null;
    script_outline: string | null;
    format: string | null;
    why_it_may_work: string | null;
    production_complexity: string | null;
    notes: string | null;
    status: string;
    approved_by: string | null;
  }>;
}

