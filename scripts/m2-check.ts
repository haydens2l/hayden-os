import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { brisbaneToday } from "../src/lib/dates";
import { syncDatabase } from "../src/lib/db/seed";
import { attentionWindow } from "../src/lib/priority/engine";
import {
  captureText,
  deferDecision,
  delegateWork,
  insertDecision,
  insertTask,
  recordDecisionChoice,
  setTaskStatus,
  todayBoard,
} from "../src/lib/priority/store";

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

function openFresh(label: string) {
  const file = path.join(os.tmpdir(), `hayden-${label}-${Date.now()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  return { db, file };
}

function factors(financialImpact: number) {
  return {
    financialImpact,
    urgency: 5,
    strategicImportance: 5,
    haydenDependency: 5,
    risk: 2,
    timeCost: 1,
  };
}

const fresh = openFresh("m2");
syncDatabase(fresh.db);
const version = fresh.db.prepare("SELECT value FROM app_meta WHERE key = 'seed_version'").get() as { value: string };
check("seed version 2", version.value === "2", version.value);
const invented = fresh.db.prepare("SELECT COUNT(*) AS n FROM findings").get() as { n: number };
const metrics = fresh.db.prepare("SELECT COUNT(*) AS n FROM organisation_metrics").get() as { n: number };
const campaigns = fresh.db.prepare("SELECT COUNT(*) AS n FROM campaigns").get() as { n: number };
check("no invented findings", invented.n === 0);
check("no invented metrics", metrics.n === 0);
check("no invented campaigns", campaigns.n === 0);

const today = brisbaneToday();
const lilyTask = insertTask(fresh.db, {
  organisationId: "media-empire",
  title: "Format the remaining captions",
  ownerId: "lily",
  dataStatus: "demo",
  why: "Production cleanup.",
  factors: { financialImpact: 0, urgency: 1, strategicImportance: 0, haydenDependency: 0, risk: 0, timeCost: 1 },
});
let board = todayBoard(fresh.db, today);
check(
  "low-value Lily task stays off Hayden attention",
  !board.attention.some((item) => item.id === lilyTask),
  board.attention.map((item) => item.title).join(", ") || "empty attention",
);

const approval = insertDecision(fresh.db, {
  organisationId: "wlth",
  title: "Approve the WLTH creative direction",
  ownerId: "hayden",
  dataStatus: "demo",
  context: "Production is waiting on a direction.",
  options: ["Stand-up mortgage", "Profession comparison"],
  recommendedOption: "Stand-up mortgage",
  evidence: "Demo evidence. Not a live result.",
  costOfDelay: "The edit queue stops.",
  dueDate: brisbaneToday(1),
  factors: factors(5),
});
board = todayBoard(fresh.db, today);
check("high-value decision appears", board.attention.some((item) => item.id === approval));
const assessment = fresh.db
  .prepare(
    `SELECT score, financial_impact, urgency, strategic_importance, hayden_dependency, risk, time_cost, reasoning, source, manual_override, classification, created_at
     FROM priority_assessments WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1`,
  )
  .get(approval) as {
  score: number;
  financial_impact: number;
  reasoning: string;
  source: string;
  manual_override: number;
  classification: string;
  created_at: string;
};
check("assessment stores score and factors", assessment.score === 53 && assessment.financial_impact === 5);
check("assessment stores reasoning, source, time, and no override", Boolean(assessment.reasoning && assessment.created_at) && assessment.source === "priority-engine" && assessment.manual_override === 0 && assessment.classification === "hayden_now");

delegateWork(fresh.db, {
  entityType: "decision",
  entityId: approval,
  assigneeType: "person",
  assigneeId: "lily",
  deadline: brisbaneToday(3),
  expectedOutcome: "Lily returns with the chosen direction ready to produce.",
});
board = todayBoard(fresh.db, today);
check("delegated decision leaves active attention", !board.attention.some((item) => item.id === approval));
check("delegated decision is visible as delegated", board.delegated.some((item) => item.id === approval));

const stalled = insertTask(fresh.db, {
  organisationId: "speed-to-lead",
  title: "Clear the remaining Speed to Lead notes",
  ownerId: "lily",
  dataStatus: "demo",
  factors: { financialImpact: 1, urgency: 2, strategicImportance: 1, haydenDependency: 1, risk: 1, timeCost: 2 },
});
delegateWork(fresh.db, {
  entityType: "task",
  entityId: stalled,
  assigneeType: "person",
  assigneeId: "lily",
  deadline: brisbaneToday(-2),
  expectedOutcome: "The notes are cleaned.",
});
fresh.db.prepare(`UPDATE tasks SET status = 'blocked', due_date = ? WHERE id = ?`).run(brisbaneToday(-2), stalled);
board = todayBoard(fresh.db, today);
const escalated = board.attention.find((item) => item.id === stalled);
check("overdue blocked delegation escalates", escalated?.classification === "hayden_now", escalated?.classification ?? "missing");

const idea = captureText(fresh.db, "Idea: Brisbane Collective suburb leaderboard.");
board = todayBoard(fresh.db, today);
check("idea capture is an idea", idea.kind === "idea");
check("idea is in the inbox", board.inbox.some((item) => item.id === idea.id && item.kind === "idea"));
check("idea is not urgent attention", !board.attention.some((item) => item.title.includes("suburb leaderboard")));
const ideaTasks = fresh.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE title LIKE '%suburb leaderboard%'`).get() as { n: number };
check("idea does not become a task", ideaTasks.n === 0);

const five: string[] = [];
for (let impact = 5; impact >= 1; impact -= 1) {
  five.push(
    insertDecision(fresh.db, {
      organisationId: "inception",
      title: `Choose offer direction ${impact}`,
      ownerId: "hayden",
      dataStatus: "demo",
      context: "Hayden has to choose.",
      options: ["Keep", "Change"],
      recommendedOption: "Keep",
      dueDate: brisbaneToday(1),
      factors: factors(impact),
    }),
  );
}
board = todayBoard(fresh.db, today);
const ranked = board.attention.filter((item) => five.includes(item.id));
check("five Hayden decisions are classified now", ranked.length === 5, String(ranked.length));
const window = attentionWindow(board.attention, false);
const expanded = attentionWindow(board.attention, true);
check("default attention window is 3", window.length === 3, String(window.length));
check("expanded attention window is 5", expanded.length === 5, String(expanded.length));
check(
  "default window is the highest three",
  window.map((item) => item.id).join() === five.slice(0, 3).join(),
  window.map((item) => `${item.title}:${item.score}`).join(", "),
);

const doneId = insertTask(fresh.db, {
  organisationId: "fifo",
  title: "Note a finished check",
  ownerId: "drew",
  dataStatus: "demo",
  factors: { financialImpact: 0, urgency: 1, strategicImportance: 0, haydenDependency: 0, risk: 0, timeCost: 1 },
});
setTaskStatus(fresh.db, doneId, "done");
const deferId = insertDecision(fresh.db, {
  organisationId: "fifo",
  title: "Defer a partnership note",
  ownerId: "hayden",
  dataStatus: "demo",
  options: ["Wait", "Proceed"],
  factors: { financialImpact: 2, urgency: 2, strategicImportance: 2, haydenDependency: 3, risk: 1, timeCost: 1 },
});
deferDecision(fresh.db, deferId, brisbaneToday(7));
const decideId = insertDecision(fresh.db, {
  organisationId: "fifo",
  title: "Record a small choice",
  ownerId: "hayden",
  dataStatus: "demo",
  options: ["Yes", "No"],
  factors: { financialImpact: 2, urgency: 2, strategicImportance: 2, haydenDependency: 3, risk: 1, timeCost: 1 },
});
recordDecisionChoice(fresh.db, decideId, "Yes");

const actions = fresh.db.prepare(`SELECT actions_taken FROM audit_log`).all() as Array<{ actions_taken: string }>;
const text = actions.map((row) => row.actions_taken).join("\n");
for (const expected of ["created task", "created decision", "delegated to person:lily", "captured as idea", "status=done", "deferred until", "decided: Yes"]) {
  check(`audit contains ${expected}`, text.includes(expected));
}

const upgrade = openFresh("upgrade");
const now = new Date().toISOString();
upgrade.db.prepare(
  `INSERT INTO organisations (id, parent_id, slug, name, type, status, description, owner, notes, sort_order, pulse_status, interpretation, created_at, updated_at)
   VALUES ('inception', NULL, 'inception', 'Inception Wealth Group', 'brand', 'active', 'Brisbane homeowners.', 'Hayden Pawelski', 'old', 1, 'watch', 'CPL jumped', ?, ?),
          ('fifo', NULL, 'fifo', 'FIFO Investor', 'brand', 'active', 'FIFO workers.', 'Hayden Pawelski', 'old', 2, 'healthy', 'Show rate fell', ?, ?),
          ('wlth', NULL, 'wlth', 'WLTH', 'brand', 'active', 'Lending.', 'Hayden Pawelski', 'old', 3, NULL, NULL, ?, ?)`,
).run(now, now, now, now, now, now);
upgrade.db.prepare(
  `INSERT INTO findings (id, category, what_happened, why_it_matters, recommended_response, requires_hayden, source, created_at)
   VALUES ('fake-finding', 'ads', 'Video #14 generated 3.2x normal reach', 'Example only', 'Ignore', 1, 'seed', ?)`,
).run(now);
upgrade.db.prepare(
  `INSERT INTO organisation_metrics (id, organisation_id, metric_date, metric_key, label, value, sort_order)
   VALUES ('fake-metric', 'inception', '2026-09-01', 'cpl', 'CPL', '$56', 1)`,
);
upgrade.db.prepare(`INSERT INTO app_meta (key, value) VALUES ('seed_version', '1')`).run();
syncDatabase(upgrade.db);
const upgraded = upgrade.db.prepare("SELECT value FROM app_meta WHERE key = 'seed_version'").get() as { value: string };
const leftover = upgrade.db.prepare(`SELECT COUNT(*) AS n FROM findings`).get() as { n: number };
const leftoverMetrics = upgrade.db.prepare(`SELECT COUNT(*) AS n FROM organisation_metrics`).get() as { n: number };
const pulse = upgrade.db.prepare(`SELECT pulse_status, interpretation FROM organisations WHERE id = 'inception'`).get() as {
  pulse_status: string | null;
  interpretation: string | null;
};
const knowledge = upgrade.db.prepare(`SELECT content FROM knowledge WHERE id = 'know-inception'`).get() as { content: string };
check("version 1 upgrades to 2", upgraded.value === "2");
check("upgrade deletes invented findings", leftover.n === 0);
check("upgrade deletes invented metrics", leftoverMetrics.n === 0);
check("upgrade clears fake pulse", pulse.pulse_status === null && pulse.interpretation === null);
check("positioning note is guidance", knowledge.content.includes("Positioning note") && !knowledge.content.toLowerCase().includes("3.2"));

fresh.db.close();
upgrade.db.close();
fs.rmSync(fresh.file, { force: true });
fs.rmSync(upgrade.file, { force: true });

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nMilestone 2 checks passed");
