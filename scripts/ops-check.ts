import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { syncDatabase } from "../src/lib/db/seed";
import { appointmentsIn, compareShowRate, drillShowRate, showRate } from "../src/lib/ops/analyse";
import { answerOps, confirmShowRate } from "../src/lib/ops/command";
import { createWorkFromFinding, refreshFindings } from "../src/lib/ops/findings";
import { importAppointments } from "../src/lib/ops/import";
import { confirmKpi } from "../src/lib/ops/kpis";
import { listWork } from "../src/lib/work/state";

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
  const file = path.join(os.tmpdir(), `hayden-ops-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  syncDatabase(db);
  return db;
}

function row(day: string, status: string, setter: string, delay: number, extra = "") {
  const booked = new Date(Date.parse(`${day}T00:00:00Z`) - delay * 86400000).toISOString().slice(0, 10);
  return `${setter.toLowerCase()},${setter} lead,${setter},${day},${booked},${status},yes,no,${extra}`;
}

function main() {
  const db = openDb();
  const header = "phone,name,setter,appointment_date,booked_at,status,confirmation,partner,evidence,evidence_type,rebooking_attempted";
  const lines = [header];
  for (let i = 0; i < 18; i += 1) lines.push(row("2026-09-03", "sat", i % 2 ? "Josh" : "Sarah", 1, ",,0"));
  for (let i = 0; i < 7; i += 1) lines.push(row("2026-09-04", "no-show", "Sarah", 2, ",,0"));
  for (let i = 0; i < 8; i += 1) lines.push(row("2026-09-10", "sat", "Josh", 1, ",,1"));
  for (let i = 0; i < 3; i += 1) lines.push(row("2026-09-11", "sat", "Sarah", 4, ",,1"));
  for (let i = 0; i < 5; i += 1) lines.push(row("2026-09-12", "no-show", "New Setter", 8, ",,0"));
  for (let i = 0; i < 2; i += 1) lines.push(row("2026-09-12", "no-show", "Josh", 1, ",,0"));
  lines.push("0400111222,Sam,Nic,2026-09-20,2026-09-01,no-show,no,yes,I might not make it if my partner is working.,transcript,0");
  lines.push("0400111333,Pat,Nic,2026-09-12,2026-09-11,booked,no,no,any afternoon works,transcript,0");
  const bad = `${header}\nnot-a-date,Bad,Josh,yesterday,2026-09-01,sat,yes,no,,,0`;
  const imported = importAppointments(db, {
    organisationId: "fifo",
    fileName: "appointments.csv",
    csvText: `${lines.join("\n")}\n${bad.split("\n")[1]}`,
    mapping: {
      phone: "phone",
      name: "name",
      setter: "setter",
      appointment_at: "appointment_date",
      booked_at: "booked_at",
      status: "status",
      confirmation: "confirmation",
      partner: "partner",
      evidence: "evidence",
      evidence_type: "evidence_type",
      rebooking_attempted: "rebooking_attempted",
    },
  });
  const provenance = db.prepare(`SELECT source_name, period_start, period_end, rows_accepted, rows_rejected FROM ops_imports WHERE id = ?`).get(imported.importId) as {
    source_name: string;
    period_start: string;
    period_end: string;
    rows_accepted: number;
    rows_rejected: number;
  };
  check("A import keeps rows and provenance", provenance.source_name === "appointments.csv" && provenance.rows_rejected === 1 && provenance.rows_accepted > 0 && provenance.period_start === "2026-09-03");

  const current = appointmentsIn(db, "fifo", "2026-09-08", "2026-09-14");
  const previous = appointmentsIn(db, "fifo", "2026-09-01", "2026-09-07");
  confirmShowRate(db, "fifo");
  const rate = showRate(current);
  const definition = db.prepare(`SELECT formula, status FROM ops_kpi_definitions WHERE organisation_id = 'fifo' AND kpi_key = 'show_rate'`).get() as { formula: string; status: string };
  check("B show rate shows formula and counts", definition.status === "confirmed" && /appointments sat/.test(definition.formula) && rate.sat === 11 && rate.denominator === 18);

  const comparison = compareShowRate(current, previous);
  check("C period comparison keeps both counts", comparison.before.sat === 18 && comparison.before.denominator === 25 && comparison.now.sat === 11 && comparison.now.denominator === 18 && comparison.meaningful);

  const drilled = drillShowRate(current);
  const delay = drilled.delays.find((item) => item.name === "6+ days");
  check("D drilldown uses a stored dimension", Boolean(delay) && (delay?.sat ?? 1) === 0 && /6\+ days/.test(drilled.concentrated.map((item) => item.name).join(" ")) && !/ads got worse|lead mix/.test(JSON.stringify(drilled)));

  refreshFindings(db, "fifo", appointmentsIn(db, "fifo"), { start: "2026-09-08", end: "2026-09-14" });
  const noShowFinding = db.prepare(`SELECT * FROM ops_findings WHERE finding_key = 'unattended-no-shows'`).get() as { id: string; evidence: string; hayden_required: number; suggested_owner_id: string };
  const noShowText = `${noShowFinding?.evidence ?? ""} ${db.prepare(`SELECT what_happened FROM ops_findings WHERE finding_key = 'unattended-no-shows'`).get() ? (db.prepare(`SELECT what_happened AS text FROM ops_findings WHERE finding_key = 'unattended-no-shows'`).get() as { text: string }).text : ""}`;
  check("E unattended no-show finding", Boolean(noShowFinding) && /no-show/i.test(noShowText) && /rebooking/i.test(noShowText));

  const attendance = db.prepare(`SELECT evidence FROM ops_findings WHERE finding_key LIKE 'attendance-%'`).all() as Array<{ evidence: string }>;
  check("F transcript evidence is exact", attendance.length === 1 && attendance[0].evidence === "I might not make it if my partner is working.");
  const invented = attendance.some((item) => /pat|any afternoon/.test(item.evidence) && !/partner is working/.test(item.evidence));
  check("G no transcript means no invented concern", attendance.length === 1 && !invented);

  const taskId = createWorkFromFinding(db, noShowFinding.id);
  const work = listWork(db).find((item) => item.sourceId === taskId);
  check("H finding enters the work list", Boolean(work));
  check("I AP owns it and Hayden is not required", work?.ownerId === "ap" && work.haydenRequired === false && noShowFinding.hayden_required === 0);

  const missing = answerOps(db, "How did WLTH perform yesterday?");
  check("J missing data is stated", /no operational data is stored/i.test(missing.summary) && !/\d%/.test(missing.summary));

  let bookingThrew = false;
  try {
    confirmKpi(db, "fifo", "booking_rate");
  } catch {
    bookingThrew = true;
  }
  check("J booking rate is not guessed", bookingThrew);

  const livePath = path.join(process.cwd(), "data", "hayden.db");
  if (fs.existsSync(livePath)) {
    const live = new Database(livePath, { readonly: true });
    const table = live.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ops_appointments'`).get() as { name: string } | undefined;
    const count = table ? (live.prepare(`SELECT COUNT(*) AS n FROM ops_appointments`).get() as { n: number }).n : 0;
    check("K live database has no operational rows", count === 0);
    live.close();
  } else {
    check("K live database has no operational rows", true);
  }

  db.close();
  if (failures.length) {
    console.error(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log("\nops checks passed");
}

main();
