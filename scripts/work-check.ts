import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { syncDatabase } from "../src/lib/db/seed";
import { HELP_SECTIONS, capabilityGroups } from "../src/lib/help/guide";
import { getVideoProvider } from "../src/lib/executor/providers";
import { executionBrief } from "../src/lib/work/brief";
import { answerWork } from "../src/lib/work/command";
import { approveDeliverable, assignExecution, markBlocked, requestChanges, startWork, submitWork } from "../src/lib/work/execute";
import { saveSuggestion } from "../src/lib/work/rules";
import { getWork, haydenQueue, reviewQueue } from "../src/lib/work/state";

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS ${name}`);
    return;
  }
  failures.push(detail ? `${name} — ${detail}` : name);
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function openDb() {
  const file = path.join(os.tmpdir(), `hayden-work-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  syncDatabase(db);
  return db;
}

function insertPack(db: Database.Database, title: string) {
  const conceptId = crypto.randomUUID();
  const packId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO creative_concepts (id, organisation_id, brand, title, objective, status, created_by, created_at)
     VALUES (?, 'property-made-simple', 'Property Made Simple', ?, 'Make the approved piece.', 'approved', 'hayden', ?)`,
  ).run(conceptId, title, now);
  db.prepare(
    `INSERT INTO production_packs (
      id, root_id, version, creative_concept_id, organisation_id, brand, production_type, aspect_ratio, number_of_scenes, status,
      script, voice_direction, character_bible, continuity_rules, on_screen_text, unapproved_override, executor, created_by, created_at, updated_at
    ) VALUES (?, ?, 1, ?, 'property-made-simple', 'Property Made Simple', 'ai_video', '9:16', 1, 'approved',
      'Dave walks in.', 'Calm Australian.', 'Dave.', 'Match the frames.', 'None.', 0, 'human', 'content', ?, ?)`,
  ).run(packId, packId, conceptId, now, now);
  db.prepare(
    `INSERT INTO production_scenes (id, pack_id, scene_number, duration_seconds, objective, visual, start_frame, end_frame, video_prompt, voiceover, on_screen_text, production_notes)
     VALUES (?, ?, 1, 8, 'Open', 'Kitchen', 'Dave at the door', 'Dave at the table', 'Walk in.', 'The house is still there.', 'None', 'Keep it ordinary.')`,
  ).run(crypto.randomUUID(), packId);
  return packId;
}

function main() {
  delete process.env.GEMINI_API_KEY;
  const db = openDb();
  const packId = insertPack(db, "Mortgage Housemate");

  const assigned = assignExecution(db, packId, "lily");
  const afterAssign = getWork(db, "production_pack", packId);
  const brief = executionBrief(db, packId);
  check("A Lily owns the work", afterAssign?.ownerId === "lily" && afterAssign.haydenRequired === false && brief.some((section) => section.label === "What you are making"), assigned.note);

  startWork(db, packId);
  check("B in progress", getWork(db, "production_pack", packId)?.stage === "IN PROGRESS");

  const version = submitWork(db, packId, { by: "lily", note: "V1 cut", filePath: "/tmp/housemate-v1.mp4", fileName: "housemate-v1.mp4" });
  const afterSubmit = getWork(db, "production_pack", packId);
  check("C ready for review", version === 1 && afterSubmit?.stage === "READY FOR REVIEW" && afterSubmit.haydenRequired === true && reviewQueue(db).some((row) => row.sourceId === packId));

  requestChanges(db, packId, "The first three seconds are too slow.");
  const versions = db.prepare(`SELECT version, review_status, feedback FROM work_submissions WHERE source_id = ? ORDER BY version`).all(packId) as Array<{ version: number; review_status: string; feedback: string | null }>;
  const afterChanges = getWork(db, "production_pack", packId);
  check("D feedback kept and returned", versions.length === 1 && versions[0].feedback === "The first three seconds are too slow." && afterChanges?.stage === "CHANGES REQUESTED" && afterChanges.haydenRequired === false);

  submitWork(db, packId, { by: "lily", note: "V2 cut", filePath: "/tmp/housemate-v2.mp4", fileName: "housemate-v2.mp4" });
  const both = db.prepare(`SELECT version FROM work_submissions WHERE source_id = ? ORDER BY version`).all(packId) as Array<{ version: number }>;
  check("E both versions exist", both.map((row) => row.version).join(",") === "1,2");

  const approved = approveDeliverable(db, packId);
  const afterApprove = getWork(db, "production_pack", packId);
  const linked = db.prepare(`SELECT file_path, review_status FROM work_submissions WHERE source_id = ? AND version = 2`).get(packId) as { file_path: string; review_status: string };
  check("F complete and unlinked from Hayden", afterApprove?.stage === "COMPLETE" && afterApprove.haydenRequired === false && linked.review_status === "approved" && linked.file_path === "/tmp/housemate-v2.mp4" && /Completed/.test(approved.summary) && !/performs better/i.test(approved.summary));

  const haydenPack = insertPack(db, "Needs Hayden");
  assignExecution(db, haydenPack, "danny");
  markBlocked(db, haydenPack, "Need a call on the offer", "Hayden");
  check("G blocker that needs Hayden surfaces", haydenQueue(db).some((row) => row.sourceId === haydenPack));

  const quietPack = insertPack(db, "API down");
  assignExecution(db, quietPack, "lily");
  markBlocked(db, quietPack, "API unavailable", "The render tool");
  const quiet = getWork(db, "production_pack", quietPack);
  check("H blocker that does not need Hayden stays off his list", quiet?.stage === "BLOCKED" && quiet.haydenRequired === false && !haydenQueue(db).some((row) => row.sourceId === quietPack));

  const rulePack = insertPack(db, "Corporate Dave");
  assignExecution(db, rulePack, "lily");
  startWork(db, rulePack);
  submitWork(db, rulePack, { by: "lily", note: "Cut", link: "https://example.test/v1" });
  const beforeRules = (db.prepare(`SELECT COUNT(*) AS n FROM production_rules`).get() as { n: number }).n;
  const suggested = requestChanges(db, rulePack, "Dave looks too corporate.");
  const pending = db.prepare(`SELECT body, status FROM rule_suggestions WHERE id = ?`).get(suggested.suggestionId) as { body: string; status: string } | undefined;
  const during = (db.prepare(`SELECT COUNT(*) AS n FROM production_rules`).get() as { n: number }).n;
  check("I suggestion is not saved yet", Boolean(suggested.suggestionId) && pending?.status === "pending" && /everyday Australians/.test(pending.body) && during === beforeRules);
  saveSuggestion(db, suggested.suggestionId!);
  const afterRules = (db.prepare(`SELECT COUNT(*) AS n FROM production_rules`).get() as { n: number }).n;
  check("I rule saves only after approval", afterRules === beforeRules + 1);

  const everyone = answerWork(db, "What is everyone working on?");
  check("J everyone comes from stored work", everyone.items.some((item) => item.title === "Needs Hayden") && everyone.items.some((item) => item.title === "API down"));

  const waiting = answerWork(db, "What's waiting on me?");
  check("K waiting is only Hayden-required work", waiting.items.some((item) => item.title === "Needs Hayden") && !waiting.items.some((item) => item.title === "API down") && waiting.items.every((item) => haydenQueue(db).some((row) => row.title === item.title)));

  const help = HELP_SECTIONS.find((section) => section.id === "video-scenes");
  const helpText = (help?.paragraphs ?? []).join(" ");
  const capabilities = capabilityGroups();
  check(
    "L video stays built and not configured",
    fs.existsSync(path.join(process.cwd(), "src/lib/executor/video/gemini.ts")) &&
      /Built: yes/.test(helpText) &&
      /not currently configured/.test(helpText) &&
      capabilities.video.built === true &&
      capabilities.video.configured === false &&
      getVideoProvider().connected === false,
  );

  db.close();
  if (failures.length) {
    console.error(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log("\nwork checks passed");
}

main();
