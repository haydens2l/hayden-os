import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { syncDatabase } from "../src/lib/db/seed";
import { storeAircallCalls } from "../src/lib/integrations/aircall/sync";
import { mapAppointmentStatus, routeGhlPipeline, storeGhlRecords } from "../src/lib/integrations/ghl/sync";
import { showRate, appointmentsIn } from "../src/lib/ops/analyse";
import { connectorStatus } from "../src/lib/ops/connectors";

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
  const file = path.join(os.tmpdir(), `hayden-connect-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  syncDatabase(db);
  return db;
}

function liveActivityCount() {
  const live = new Database(path.join(process.cwd(), "data/hayden.db"), { readonly: true });
  const columns = live.prepare(`PRAGMA table_info(ops_activities)`).all() as Array<{ name: string }>;
  const count = columns.some((column) => column.name === "external_source")
    ? (live.prepare(`SELECT COUNT(*) AS n FROM ops_activities WHERE external_source IN ('aircall', 'gohighlevel')`).get() as { n: number }).n
    : 0;
  live.close();
  return count;
}

function main() {
  const liveBefore = liveActivityCount();
  const db = openDb();
  const before = connectorStatus(db);
  check("A both sources start disconnected", before.find((item) => item.id === "aircall")?.connected === false && before.find((item) => item.id === "gohighlevel")?.connected === false);

  const call = {
    id: 812,
    direction: "outbound",
    status: "done",
    started_at: 1750000000,
    answered_at: 1750000005,
    raw_digits: "+61 400 111 222",
    user: { name: "Nic" },
    contact: { id: 44, first_name: "Sam", last_name: "Lee", phone_numbers: [{ value: "+61400111222" }] },
  };
  storeAircallCalls(db, "fifo", [call, { ...call, id: 813, contact: call.contact }]);
  storeAircallCalls(db, "fifo", [call]);
  const calls = db.prepare(`SELECT COUNT(*) AS n FROM ops_activities WHERE external_source = 'aircall'`).get() as { n: number };
  const leads = db.prepare(`SELECT COUNT(*) AS n FROM ops_leads WHERE external_source = 'aircall'`).get() as { n: number };
  const evidence = db.prepare(`SELECT evidence FROM ops_activities WHERE external_source = 'aircall' AND external_id = '812'`).get() as { evidence: string | null };
  check("B aircall calls do not duplicate and are not transcripts", calls.n === 2 && leads.n === 1 && evidence.evidence == null);

  const mapped = mapAppointmentStatus("confirmed");
  const showed = mapAppointmentStatus("showed");
  const unknown = mapAppointmentStatus("invalid");
  check("C confirmed is booked and showed is sat", mapped.status === "booked" && showed.status === "sat" && unknown.known === false && unknown.status === "invalid");

  storeGhlRecords(
    db,
    "fifo",
    [{ id: "c1", firstName: "Pat", lastName: "Nguyen", phone: "0400111333" }],
    [
      { id: "e1", contactId: "c1", appointmentStatus: "showed", startTime: "2026-09-10T01:00:00.000Z" },
      { id: "e2", contactId: "c1", appointmentStatus: "confirmed", startTime: "2026-09-12T01:00:00.000Z" },
      { id: "e3", contactId: "c1", appointmentStatus: "invalid", startTime: 1750000000000 },
    ],
  );
  storeGhlRecords(db, "fifo", [{ id: "c1", firstName: "Pat", lastName: "Nguyen", phone: "0400111333" }], [{ id: "e1", contactId: "c1", appointmentStatus: "showed", startTime: "2026-09-10T01:00:00.000Z" }]);
  const appointments = db.prepare(`SELECT status FROM ops_appointments WHERE external_source = 'gohighlevel' ORDER BY external_id`).all() as Array<{ status: string }>;
  const rate = showRate(appointmentsIn(db, "fifo", "2026-09-01", "2026-09-30"));
  check("D ghl statuses stay distinct and only a show enters the show count", appointments.map((item) => item.status).join(",") === "sat,booked,invalid" && rate.sat === 1 && rate.denominator === 1);
  check(
    "D2 pipelines route to the named businesses",
    routeGhlPipeline("Meta")?.organisationId === "fifo" &&
      routeGhlPipeline("Paid off home")?.angle === "paid off" &&
      routeGhlPipeline("Brisbane Paid off")?.organisationId === "inception" &&
      routeGhlPipeline("Inception Finance Meta") == null &&
      routeGhlPipeline("Perth In Home") == null,
  );

  check("E live database was not written by this check", liveActivityCount() === liveBefore);
  if (failures.length) {
    console.error(`${failures.length} failed`);
    process.exit(1);
  }
  console.log("connect checks passed");
}

main();
