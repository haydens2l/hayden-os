import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { supersedeKnowledge } from "../src/lib/brain/store";
import { answerFromBrain, type BrainMemory } from "../src/lib/command/brain-answer";
import { syncDatabase } from "../src/lib/db/seed";
import { priorityScore } from "../src/lib/priority/engine";

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

function memory(db: Database.Database): BrainMemory {
  return {
    organisations: db.prepare(`SELECT * FROM organisations`).all() as BrainMemory["organisations"],
    knowledge: db.prepare(`SELECT * FROM knowledge`).all() as BrainMemory["knowledge"],
    people: db.prepare(`SELECT * FROM people`).all() as BrainMemory["people"],
    openQuestions: db.prepare(`SELECT * FROM open_questions`).all() as BrainMemory["openQuestions"],
    metrics: db.prepare(`SELECT * FROM organisation_metrics`).all() as BrainMemory["metrics"],
  };
}

function joined(answer: { summary: string; items: Array<{ detail: string; kind?: string }> }, kind?: string) {
  const items = kind ? answer.items.filter((item) => item.kind === kind) : answer.items;
  return [answer.summary, ...items.map((item) => item.detail)].join(" ").toLowerCase();
}

const file = path.join(os.tmpdir(), `hayden-brain-${Date.now()}.db`);
const db = new Database(file);
db.pragma("foreign_keys = ON");
db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
syncDatabase(db);

const version = db.prepare(`SELECT value FROM app_meta WHERE key = 'seed_version'`).get() as { value: string };
check("strategy seed is version 3", version.value === "3", version.value);

const score = priorityScore({
  financialImpact: 5,
  urgency: 5,
  strategicImportance: 5,
  haydenDependency: 5,
  risk: 2,
  timeCost: 1,
});
check("priority formula is unchanged", score === 53, String(score));

let brain = memory(db);
const speed = answerFromBrain("What is the strategy for Speed to Lead?", brain);
check("speed to lead answer exists", Boolean(speed));
const speedText = speed ? joined(speed, "Founder strategy") : "";
check("speed to lead is cash flow and service", /cash flow/.test(speedText));
check("speed to lead is being reduced or optimised", /reduc/.test(speedText) && /optim/.test(speedText));
check("speed to lead keeps hayden involvement low", /minimal hayden|low hayden/.test(speedText));

const brisbane = answerFromBrain("What is Brisbane Collective trying to become?", brain);
const brisbaneText = brisbane ? joined(brisbane) : "";
check("brisbane is an owned media audience", /audience|owned/.test(brisbaneText));
check("brisbane is not framed as a property sales business", /not primarily about selling|not a property sales page/.test(brisbaneText));

const split = answerFromBrain("What should Hayden do versus Lily?", brain);
const splitText = split ? joined(split) : "";
check("hayden side is strategy and creative direction", /strateg/.test(splitText) && /creative direction/.test(splitText));
check("lily side is production execution", /production/.test(splitText) && /execution|instructions/.test(splitText));

const cpl = answerFromBrain("What do we know about current Inception CPL?", brain);
check("inception cpl is unknown", Boolean(cpl) && /no current live figure is stored/.test(cpl?.summary.toLowerCase() ?? ""));
check("inception cpl answer is labelled unknown", Boolean(cpl?.items.some((item) => item.kind === "Unknown")));

const now = new Date().toISOString();
db.prepare(
  `INSERT INTO knowledge (
    id, organisation_id, category, title, content, source, confidence, created_at, updated_at,
    context_type, data_status, source_type, source_name
  ) VALUES ('old-stl', 'speed-to-lead', 'strategy', 'Old Speed to Lead direction', 'Grow Speed to Lead aggressively.', 'Hayden', 'high', ?, ?, 'STRATEGY', 'manual', 'hayden', 'Founder provided')`,
).run(now, now);
supersedeKnowledge(db, {
  oldId: "old-stl",
  title: "Current Speed to Lead direction",
  content: "Reduce Speed to Lead client load and minimise founder involvement.",
});
brain = memory(db);
const after = answerFromBrain("What is the strategy for Speed to Lead?", brain);
const currentText = after ? joined(after, "Founder strategy") : "";
const historyText = after ? joined(after, "Historical information") : "";
check("current strategy uses the newer direction", /reduce speed to lead client load|minimise founder involvement|minimal hayden/.test(currentText));
check("current strategy does not teach the old growth line", !currentText.includes("grow speed to lead aggressively"));
check("history keeps the superseded line", historyText.includes("grow speed to lead aggressively"));
const oldRow = db.prepare(`SELECT context_type, superseded_by_id FROM knowledge WHERE id = 'old-stl'`).get() as {
  context_type: string;
  superseded_by_id: string | null;
};
check("old record remains and is historical", oldRow.context_type === "HISTORICAL" && Boolean(oldRow.superseded_by_id));

const unknowns = answerFromBrain("What are the biggest unknowns in the business?", brain);
const unknownText = unknowns ? joined(unknowns, "Unknown") : "";
check("unknowns are the stored open questions", (unknowns?.items.length ?? 0) >= 5);
check("unknowns include the missing revenue and cpl gaps", /revenue/.test(unknownText) && /cpl/.test(unknownText));
check("unknowns do not invent a figure", !/\$\d/.test(unknownText));

const orgs = db.prepare(`SELECT id, data_status, source_name, strategic_priority FROM organisations`).all() as Array<{
  id: string;
  data_status: string;
  source_name: string;
  strategic_priority: number;
}>;
check(
  "organisations are manual founder context",
  orgs.every((org) => org.data_status === "manual" && org.source_name === "Founder provided"),
);
check("speed to lead strategic priority is low", orgs.find((org) => org.id === "speed-to-lead")?.strategic_priority === 2);
check("media and inception are central", orgs.find((org) => org.id === "media-empire")?.strategic_priority === 5 && orgs.find((org) => org.id === "inception")?.strategic_priority === 5);

const notes = db.prepare(`SELECT data_status, source_name, context_type FROM knowledge WHERE superseded_by_id IS NULL`).all() as Array<{
  data_status: string;
  source_name: string;
  context_type: string;
}>;
check(
  "active strategy is manual founder context",
  notes.every((note) => note.data_status === "manual" && note.source_name === "Founder provided" && note.context_type !== "LIVE"),
);
const live = db.prepare(`SELECT COUNT(*) AS n FROM knowledge WHERE data_status = 'live'`).get() as { n: number };
const metrics = db.prepare(`SELECT COUNT(*) AS n FROM organisation_metrics`).get() as { n: number };
check("no strategy record is marked live", live.n === 0);
check("no performance metrics were invented", metrics.n === 0);

db.prepare(`UPDATE app_meta SET value = '2' WHERE key = 'seed_version'`).run();
syncDatabase(db);
const again = db.prepare(`SELECT value FROM app_meta WHERE key = 'seed_version'`).get() as { value: string };
check("version 2 upgrades to 3", again.value === "3");

db.close();
fs.rmSync(file, { force: true });

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nBusiness brain checks passed");
