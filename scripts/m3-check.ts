import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { answerAsChief } from "../src/lib/chief/answer";
import { generateMorningBrief, saveBriefFeedback } from "../src/lib/chief/persist";
import { buildMorningBrief } from "../src/lib/chief/reason";
import { brisbaneToday } from "../src/lib/dates";
import { syncDatabase } from "../src/lib/db/seed";
import { priorityScore } from "../src/lib/priority/engine";
import { assessOpenWork, insertDecision, insertTask } from "../src/lib/priority/store";

const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS ${name}`);
    return;
  }
  const message = detail ? `${name} — ${detail}` : name;
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function openDb() {
  const file = path.join(os.tmpdir(), `hayden-m3-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  syncDatabase(db);
  return db;
}

const low = { financialImpact: 1, urgency: 1, strategicImportance: 1, haydenDependency: 0, risk: 0, timeCost: 1 };
const founder = { financialImpact: 5, urgency: 5, strategicImportance: 5, haydenDependency: 5, risk: 2, timeCost: 1 };

const score = priorityScore(founder);
check("priority formula is unchanged", score === 53, String(score));

async function main() {
const example = openDb();
for (let index = 1; index <= 10; index += 1) {
  insertTask(example, {
    id: `stl-${index}`,
    organisationId: "speed-to-lead",
    title: `CRM cleanup ${index}`,
    ownerId: "ap",
    dataStatus: "demo",
    why: "Routine CRM hygiene.",
    factors: low,
  });
}
example
  .prepare(
    `INSERT INTO opportunities (
      id, organisation_id, category, title, description, potential_value, confidence, recommended_action, owner_id, status, created_at,
      data_status, source_type, source_name, last_updated
    ) VALUES (?, 'property-made-simple', 'creative', ?, ?, NULL, 'high', ?, 'hayden', 'open', ?, 'demo', 'manual', 'Milestone 3 test', ?)`,
  )
  .run(
    "opp-creative",
    "Approve the next Property Made Simple creative batch",
    "Creative approval on an owned media brand.",
    "Hayden approves the creative direction",
    new Date().toISOString(),
    new Date().toISOString(),
  );
insertDecision(example, {
  id: "drew-terms",
  organisationId: "inception",
  title: "Commercial terms with Drew on the Inception appointment engine",
  ownerId: "hayden",
  dataStatus: "demo",
  why: "The commercial path cannot proceed until Hayden decides.",
  factors: founder,
});
const productionId = insertTask(example, {
  id: "lily-production",
  organisationId: "media-empire",
  title: "Routine production: export the cutdowns",
  ownerId: "hayden",
  dataStatus: "demo",
  why: "Routine production export.",
  factors: { financialImpact: 1, urgency: 1, strategicImportance: 1, haydenDependency: 2, risk: 0, timeCost: 2 },
});
const staleOn = brisbaneToday(-11);
example
  .prepare(
    `INSERT INTO organisation_metrics (
      id, organisation_id, metric_date, metric_key, label, value, sort_order, data_status, source_name, last_updated
    ) VALUES ('stale-show', 'inception', ?, 'show_rate_sample', 'Inception show rate sample', 'stored sample', 0, 'stale', 'Milestone 3 test', ?)`,
  )
  .run(staleOn, staleOn);

assessOpenWork(example, brisbaneToday());
const beforeClass = example.prepare(`SELECT classification FROM priority_assessments WHERE entity_type = 'task' AND entity_id = ? ORDER BY created_at DESC LIMIT 1`).get(productionId) as { classification: string };
const beforeKnowledge = JSON.stringify(example.prepare(`SELECT id, title, content, context_type FROM knowledge ORDER BY id`).all());
const beforeStrategy = JSON.stringify(example.prepare(`SELECT id, strategic_priority, growth_intent, desired_hayden_involvement FROM organisations ORDER BY id`).all());

const generated = await generateMorningBrief(example);
const brief = generated.brief;
const moveTitles = brief.moves.map((move) => move.title).join(" | ");
const handledText = brief.handled.map((line) => `${line.who} ${line.what} ${line.note}`).join(" ");
const ignoreText = brief.ignore.map((line) => `${line.what} ${line.why}`).join(" ");

check("A operational noise stays out of the three moves", !brief.moves.some((move) => /CRM cleanup/.test(move.title)), moveTitles);
check("A speed to lead work is summarised as handled or ignored", /speed to lead/i.test(`${handledText} ${ignoreText}`), `${handledText} ${ignoreText}`);
check("B media opportunity is one of the moves", brief.moves.some((move) => move.id === "opp-creative"), moveTitles);
check("C founder decision appears", brief.moves.some((move) => move.id === "drew-terms") || brief.decisions.some((item) => item.id === "drew-terms"), moveTitles);
check("moves stay inside the attention budget", brief.moves.length <= 3 && brief.moves.length >= 2, String(brief.moves.length));

const production = brief.recommendations.find((item) => item.id === productionId);
check("E production task is delegated", production?.recommendedClassification === "delegate", production?.recommendedClassification);
check("E production task goes to Lily", production?.recommendedOwnerId === "lily", production?.recommendedOwnerName ?? "none");
const proposal = example.prepare(`SELECT original_classification, ai_classification FROM classification_proposals WHERE entity_id = ?`).get(productionId) as { original_classification: string; ai_classification: string } | undefined;
check("E original classification is kept beside the chief class", proposal?.original_classification === "hayden_soon" && proposal.ai_classification === "delegate", JSON.stringify(proposal));
const afterClass = example.prepare(`SELECT classification FROM priority_assessments WHERE entity_type = 'task' AND entity_id = ? ORDER BY created_at DESC LIMIT 1`).get(productionId) as { classification: string };
check("E deterministic assessment is not overwritten", beforeClass.classification === afterClass.classification, `${beforeClass.classification} -> ${afterClass.classification}`);

const meta = answerAsChief(example, "How did Meta perform yesterday?");
check("D meta answer says live data is unavailable", meta.summary === "No live Meta Ads data is connected.", meta.summary);
check("D meta answer does not invent a result", !/stored sample|show rate/i.test(`${meta.summary} ${meta.items.map((item) => item.detail).join(" ")}`));

const stale = brief.stale.find((item) => item.label === "Inception show rate sample");
check("H stale metric is labelled stale", Boolean(stale && /stale/i.test(stale.detail) && /11 days/.test(stale.detail)), stale?.detail);

const feedbackId = saveBriefFeedback(example, {
  briefId: generated.id,
  recommendationId: productionId,
  verdict: "should_have_been_delegated",
  comment: "Don't bring routine setter issues to me unless Nic has already tried to resolve them.",
});
const feedback = example.prepare(`SELECT verdict, memory_status, comment FROM brief_feedback WHERE id = ?`).get(feedbackId) as { verdict: string; memory_status: string; comment: string };
check("I feedback verdict is stored", feedback.verdict === "should_have_been_delegated");
check("I feedback is pending memory review", feedback.memory_status === "pending_review", feedback.memory_status);
const afterKnowledge = JSON.stringify(example.prepare(`SELECT id, title, content, context_type FROM knowledge ORDER BY id`).all());
const afterStrategy = JSON.stringify(example.prepare(`SELECT id, strategic_priority, growth_intent, desired_hayden_involvement FROM organisations ORDER BY id`).all());
check("I feedback does not rewrite knowledge", beforeKnowledge === afterKnowledge);
check("I feedback does not rewrite strategy", beforeStrategy === afterStrategy);

const run = example.prepare(`SELECT trigger, model, records_considered, recommendations, classification_changes, confidence, duration_ms, reasoning_summary, error FROM chief_runs ORDER BY created_at DESC LIMIT 1`).get() as {
  trigger: string;
  model: string | null;
  records_considered: number;
  recommendations: string;
  classification_changes: string;
  confidence: string;
  duration_ms: number;
  reasoning_summary: string;
  error: string | null;
};
check("run log stores the trigger", run.trigger === "generate_brief");
check("run log has no model while the provider is unset", run.model == null);
check("run log counts records and recommendations", run.records_considered > 0 && run.recommendations.includes("opp-creative"));
check("run log stores classification changes", run.classification_changes.includes(productionId));
check("run log stores confidence and duration", Boolean(run.confidence) && run.duration_ms >= 0);
check("run log keeps reasoning to a summary", run.reasoning_summary.length < 400 && !/chain of thought/i.test(run.reasoning_summary));

const spend = example.prepare(`SELECT requires_approval FROM agent_permissions WHERE agent_id = 'chief-of-staff' AND resource = 'spend' AND level = 'EXECUTE'`).get() as { requires_approval: number };
check("chief still cannot spend", spend.requires_approval === 1);
check("weekly ledger is stored on the brief", Array.isArray(brief.weekly.haydenAttention) && Array.isArray(brief.weekly.delegated) && Array.isArray(brief.weekly.blocked));

console.log("\n--- EXAMPLE BRIEF ---\n");
console.log(brief.headline);
console.log(brief.moves.map((move) => move.title).join("\n"));
console.log(ignoreText);
console.log(handledText);

const bottlenecks = openDb();
const projectNames = ["PMS creative system", "Brisbane distribution", "Inception offer review", "FIFO film approval"];
const projectOrgs = ["property-made-simple", "brisbane-collective", "inception", "fifo"];
const now = new Date().toISOString();
projectNames.forEach((name, index) => {
  bottlenecks
    .prepare(
      `INSERT INTO projects (
        id, organisation_id, name, status, priority, owner_id, hayden_involvement, created_at, updated_at, data_status, source_name
      ) VALUES (?, ?, ?, 'waiting', 'high', 'hayden', 'approval', ?, ?, 'demo', 'Milestone 3 test')`,
    )
    .run(`project-${index}`, projectOrgs[index], name, now, now);
});
const bottleneckBrief = buildMorningBrief(bottlenecks);
const bottleneckText = bottleneckBrief.bottlenecks.join(" ");
check("F bottleneck sentence is present", bottleneckText.includes("You're becoming the bottleneck here."), bottleneckText);
check(
  "F every waiting project is named",
  projectNames.every((name) => bottleneckText.includes(name)),
  bottleneckText,
);

const budget = openDb();
const budgetItems: Array<[string, typeof founder]> = [
  ["Decision alpha", { financialImpact: 5, urgency: 5, strategicImportance: 5, haydenDependency: 5, risk: 2, timeCost: 1 }],
  ["Decision bravo", { financialImpact: 5, urgency: 5, strategicImportance: 4, haydenDependency: 5, risk: 2, timeCost: 1 }],
  ["Decision charlie", { financialImpact: 4, urgency: 5, strategicImportance: 4, haydenDependency: 5, risk: 1, timeCost: 1 }],
  ["Decision delta", { financialImpact: 4, urgency: 4, strategicImportance: 4, haydenDependency: 4, risk: 1, timeCost: 1 }],
  ["Decision echo", { financialImpact: 3, urgency: 4, strategicImportance: 3, haydenDependency: 4, risk: 1, timeCost: 1 }],
  ["Decision foxtrot", { financialImpact: 3, urgency: 4, strategicImportance: 3, haydenDependency: 4, risk: 0, timeCost: 2 }],
];
for (const [title, factors] of budgetItems) {
  insertDecision(budget, {
    id: title,
    organisationId: "inception",
    title,
    ownerId: "hayden",
    dataStatus: "demo",
    why: "Founder decision.",
    factors,
  });
}
const budgetBrief = buildMorningBrief(budget);
check("G only three moves", budgetBrief.moves.length === 3, budgetBrief.moves.map((move) => move.title).join(", "));
check(
  "G strongest three are the moves",
  ["Decision alpha", "Decision bravo", "Decision charlie"].every((title) => budgetBrief.moves.some((move) => move.title === title)),
  budgetBrief.moves.map((move) => move.title).join(", "),
);
const elsewhere = `${budgetBrief.watching.map((line) => line.text).join(" ")} ${budgetBrief.decisions.map((item) => item.title).join(" ")}`;
check(
  "G the other three stay visible",
  ["Decision delta", "Decision echo", "Decision foxtrot"].every((title) => elsewhere.includes(title)),
  elsewhere,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nAll milestone 3 checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
