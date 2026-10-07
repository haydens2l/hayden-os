import type Database from "better-sqlite3";
import { complete, providerStatus } from "@/lib/ai/provider";
import { CHIEF_SYSTEM_PROMPT } from "@/lib/chief/prompt";
import { buildMorningBrief, renderBriefText } from "@/lib/chief/reason";
import type { MorningBrief } from "@/lib/chief/types";
import { listOpsFindings } from "@/lib/ops/findings";
import { listWork, reviewQueue, staleLabel, staleWork } from "@/lib/work/state";

export type StoredBrief = {
  id: string;
  generated_at: string;
  agent: string;
  model: string | null;
  provider: string | null;
  context_snapshot: string;
  brief_json: string;
  brief_text: string;
  confidence: string | null;
  source: string;
  created_at: string;
};

export type StoredFeedback = {
  id: string;
  brief_id: string | null;
  recommendation_id: string | null;
  verdict: string;
  comment: string | null;
  memory_status: string;
  created_at: string;
};

export async function generateMorningBrief(db: Database.Database, trigger = "generate_brief") {
  const started = Date.now();
  const status = providerStatus();
  const brief = buildMorningBrief(db);
  noteExecution(db, brief);
  noteOperations(db, brief);
  let source: "rules" | "model" = "rules";
  let model: string | null = null;
  let provider: string | null = status.provider;
  let error: string | null = null;

  if (status.connected && status.provider && status.model) {
    const result = await complete({
      system: CHIEF_SYSTEM_PROMPT,
      user: JSON.stringify({
        instruction: "Rewrite only the headline from these already chosen moves. Do not add items.",
        headline: brief.headline,
        moves: brief.moves.map((move) => ({ title: move.action, business: move.business })),
        organisations: Object.keys(brief.context.counts),
      }),
    });
    if (result.ok) {
      const headline = groundedHeadline(result.text, brief);
      if (headline) {
        brief.headline = headline;
        source = "model";
        model = result.model;
        provider = result.provider;
      } else {
        error = "Model headline was discarded because it was not grounded in the retrieved records.";
      }
    } else {
      error = result.message;
    }
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const changes = brief.recommendations
    .filter((item) => item.originalClassification !== item.recommendedClassification)
    .map((item) => ({
      entityType: item.entityType,
      entityId: item.id,
      original: item.originalClassification,
      ai: item.recommendedClassification,
      reason: item.changeReason ?? "The chief recommendation differs from the stored classification.",
      confidence: item.confidence,
    }));
  const text = renderBriefText(brief);
  const snapshot = JSON.stringify(brief.context);

  db.prepare(
    `INSERT INTO briefs (
      id, generated_at, agent, model, provider, context_snapshot, brief_json, brief_text, confidence, source, created_at
    ) VALUES (?, ?, 'chief-of-staff', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, now, model, provider, snapshot, JSON.stringify(brief), text, brief.confidence, source, now);

  const insertChange = db.prepare(
    `INSERT INTO classification_proposals (
      id, entity_type, entity_id, original_classification, ai_classification, reason, confidence, source, run_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const change of changes) {
    insertChange.run(crypto.randomUUID(), change.entityType, change.entityId, change.original, change.ai, change.reason, change.confidence, source, runId, now);
  }

  const summary = `${brief.moves.length} moves from ${brief.recommendations.length} considered records. Attention budget is 3. Low-involvement operational work was filtered.`;
  db.prepare(
    `INSERT INTO chief_runs (
      id, trigger, model, provider, context_retrieved, records_considered, recommendations, classification_changes,
      confidence, duration_ms, error, reasoning_summary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    trigger,
    model,
    provider,
    snapshot,
    brief.recommendations.length,
    JSON.stringify(brief.moves.map((move) => ({ id: move.id, title: move.title, classification: move.recommendedClassification }))),
    JSON.stringify(changes),
    brief.confidence,
    Date.now() - started,
    error,
    summary,
    now,
  );

  db.prepare(
    `INSERT INTO agent_runs (id, agent, trigger, input_summary, output_summary, actions_taken, items_escalated, created_at)
     VALUES (?, 'chief-of-staff', ?, ?, ?, ?, ?, ?)`,
  ).run(runId, trigger, snapshot, summary, source === "model" ? "prepared brief with model headline" : "prepared brief from operating rules", String(brief.moves.length), now);

  return { id, brief, error, source, model };
}

export function listBriefs(db: Database.Database): StoredBrief[] {
  return db.prepare(`SELECT * FROM briefs ORDER BY generated_at DESC`).all() as StoredBrief[];
}

export function getBrief(db: Database.Database, id: string) {
  return db.prepare(`SELECT * FROM briefs WHERE id = ?`).get(id) as StoredBrief | undefined;
}

export function listFeedback(db: Database.Database, briefId?: string) {
  if (briefId) {
    return db.prepare(`SELECT * FROM brief_feedback WHERE brief_id = ? ORDER BY created_at DESC`).all(briefId) as StoredFeedback[];
  }
  return db.prepare(`SELECT * FROM brief_feedback ORDER BY created_at DESC`).all() as StoredFeedback[];
}

export function saveBriefFeedback(
  db: Database.Database,
  input: { briefId: string; recommendationId: string; verdict: string; comment?: string | null },
) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO brief_feedback (id, brief_id, recommendation_id, verdict, comment, memory_status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending_review', ?)`,
  ).run(id, input.briefId, input.recommendationId, input.verdict, input.comment?.trim() || null, now);
  return id;
}

function noteExecution(db: Database.Database, brief: MorningBrief) {
  const items = listWork(db);
  const reviews = reviewQueue(db);
  const blockers = items.filter((row) => row.stage === "BLOCKED" && row.haydenRequired);
  const quiet = staleWork(items);
  const recentDone = items.filter((row) => row.stage === "COMPLETE" && row.completedAt && Date.now() - new Date(row.completedAt).getTime() < 2 * 86400000);
  if (reviews.length) {
    const line = reviews.length === 1 ? `${reviews[0].title} is waiting for your review.` : `${reviews.length} pieces of work are waiting for your review.`;
    brief.stale.push({ label: "Review", detail: line });
    if (brief.headline.startsWith("Nothing stored needs you")) brief.headline = brief.headline.replace("Nothing stored needs you today.", line);
  }
  if (blockers.length) {
    brief.stale.push({ label: "Blocked", detail: blockers.slice(0, 2).map((row) => `${row.title} is blocked because ${row.blockedReason}.`).join(" ") });
  }
  if (recentDone.length) brief.changed.push(recentDone.slice(0, 2).map((row) => `${row.title} was completed.`).join(" "));
  if (quiet.length) brief.stale.push({ label: "No movement", detail: quiet.length === 1 ? staleLabel(quiet[0]) : `${quiet.length} things have not moved.` });
}

function noteOperations(db: Database.Database, brief: MorningBrief) {
  const findings = listOpsFindings(db).filter((item) => item.severity === "action" || item.severity === "critical");
  for (const finding of findings.filter((item) => item.hayden_required === 0).slice(0, 2)) {
    const who = finding.suggested_owner_id === "nic" ? "Nic" : finding.suggested_owner_id === "ap" ? "AP" : "The team";
    brief.handled.push({ who, what: finding.what_happened, note: "No Hayden action required." });
  }
  const critical = findings.find((item) => item.severity === "critical" && item.hayden_required === 1);
  if (critical) brief.stale.push({ label: "Operations", detail: critical.what_happened });
}

function groundedHeadline(raw: string, brief: MorningBrief) {
  const match = raw.match(/"headline"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const headline = (match?.[1] ?? "").replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
  if (!headline) return null;
  const sentences = headline.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length === 0 || sentences.length > 3) return null;
  if (/\$\d|\bCPL\b|\bROI\b/i.test(headline)) return null;
  if (/meta/i.test(headline)) return null;
  const known = brief.moves.flatMap((move) => [move.action, move.business ?? ""]).join(" ").toLowerCase();
  const mentioned = headline.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}/g) ?? [];
  for (const phrase of mentioned) {
    if (!known.includes(phrase.toLowerCase()) && !/speed to lead|nothing stored/i.test(phrase)) return null;
  }
  return headline;
}
