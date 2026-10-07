import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { syncDatabase } from "../src/lib/db/seed";
import { signalsFromUtterances } from "../src/lib/ops/signals";
import { answerOps } from "../src/lib/ops/command";
import { linkCallsToLeads } from "../src/lib/ops/identity";
import { createWorkFromFinding } from "../src/lib/ops/findings";
import { recordRecoveryFinding } from "../src/lib/ops/live";

const failures: string[] = [];
function check(name: string, ok: boolean) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures.push(name);
    console.error(`FAIL ${name}`);
  }
}

function openDb() {
  const db = new Database(path.join(os.tmpdir(), `hayden-live-${crypto.randomUUID()}.db`));
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  syncDatabase(db);
  return db;
}

function main() {
  const partner = signalsFromUtterances([{ speaker: "Lead", text: "I'll have to check whether Sarah can actually get off work though." }]);
  check("D partner wording is a partner signal", partner.some((item) => item.signalType === "PARTNER_ATTENDANCE_CONCERN") && !partner.some((item) => item.signalType === "LEAD_ATTENDANCE_CONCERN"));
  const attendance = signalsFromUtterances([{ speaker: "Lead", text: "I might not make it on Thursday." }]);
  check("C attendance signal keeps the exact sentence", attendance[0]?.signalType === "LEAD_ATTENDANCE_CONCERN" && attendance[0].evidence === "I might not make it on Thursday.");
  const wife = signalsFromUtterances([{ speaker: "Lead", text: "I can make it but my wife probably can't." }]);
  check("F2 wife absence is not a lead absence", wife.some((item) => item.signalType === "PARTNER_ATTENDANCE_CONCERN") && !wife.some((item) => item.signalType === "LEAD_ATTENDANCE_CONCERN"));
  const pool = signalsFromUtterances([{ speaker: "Lead", text: "My wife wants a pool." }]);
  check("F3 a wife mention without attendance is not a signal", pool.length === 0);
  const ordinary = signalsFromUtterances([{ speaker: "Lead", text: "Thursday should be fine. Thanks for the call." }]);
  check("E an ordinary call is not flagged", ordinary.length === 0);
  const forward = signalsFromUtterances([{ speaker: "Lead", text: "Any afternoon works for me." }]);
  check("F bring-forward requires the flexible wording", forward.some((item) => item.signalType === "BRING_FORWARD_FLEXIBILITY"));
  const vague = signalsFromUtterances([{ speaker: "Lead", text: "Earlier in the year we bought the house." }]);
  check("F2 earlier by itself is not a bring-forward", vague.every((item) => item.signalType !== "BRING_FORWARD_FLEXIBILITY"));
  const week = signalsFromUtterances([{ speaker: "Lead", text: "Next week. Yeah." }]);
  check("F4 next week alone is not flexibility", week.every((item) => item.signalType !== "BRING_FORWARD_FLEXIBILITY"));

  const db = openDb();
  db.prepare(`INSERT INTO ops_leads (id, organisation_id, name, phone, stage, external_id, external_source) VALUES ('ghl1', 'fifo', 'Pat', '0400111222', 'Booked Call', 'opp1', 'gohighlevel')`).run();
  db.prepare(`INSERT INTO ops_leads (id, organisation_id, name, phone, external_id, external_source) VALUES ('air1', 'fifo', 'Pat', '+61 400 111 222', 'c1', 'aircall')`).run();
  db.prepare(`INSERT INTO ops_activities (id, organisation_id, lead_id, kind, actor_name, occurred_at, outcome, external_id, external_source) VALUES ('act1', 'fifo', 'air1', 'dial', 'Josh Parkins', '2026-10-01T00:00:00.000Z', 'outbound · answered', '789', 'aircall')`).run();
  check("A phone match links the call to the GoHighLevel lead", linkCallsToLeads(db) === 1 && (db.prepare(`SELECT lead_id FROM ops_activities WHERE id = 'act1'`).get() as { lead_id: string }).lead_id === "ghl1");

  db.prepare(`INSERT INTO ops_appointments (id, organisation_id, lead_id, scheduled_at, status, external_id, external_source) VALUES ('appt1', 'fifo', 'ghl1', '2026-10-04', 'no_show', 'e1', 'gohighlevel')`).run();
  db.prepare(`INSERT INTO ops_leads (id, organisation_id, name, phone, external_source) VALUES ('other', 'fifo', 'Other', '0400999888', 'aircall')`).run();
  db.prepare(`INSERT INTO ops_activities (id, organisation_id, lead_id, kind, occurred_at, outcome, external_id, external_source) VALUES ('later', 'fifo', 'other', 'dial', '2026-10-05T00:00:00.000Z', 'outbound · answered', '790', 'aircall')`).run();
  const findingId = recordRecoveryFinding(db);
  const taskId = findingId ? createWorkFromFinding(db, findingId) : null;
  check("H a no-show gap can become work", Boolean(taskId));
  const answer = answerOps(db, "Which no-shows haven't been chased?");
  check("I chief uses the stored no-show", answer.summary.includes("1"));
  const liveBefore = new Database(path.join(process.cwd(), "data/hayden.db"), { readonly: true });
  const liveLeads = (liveBefore.prepare(`SELECT COUNT(*) AS n FROM ops_leads WHERE external_source = 'gohighlevel'`).get() as { n: number }).n;
  liveBefore.close();
  check("K fixture check did not change live lead count", liveLeads > 0);
  if (failures.length) process.exit(1);
  console.log("live ops checks passed");
}

main();
