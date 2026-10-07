import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { joshBookingReport, type BookingSignal } from "@/lib/ops/booking";
import { followUpRule, pipelineIssues } from "@/lib/ops/live";
import { noShowRows } from "@/lib/ops/noshow";
import { healthLabel, readSyncState } from "@/lib/ops/sync-state";
import { formatStamp } from "@/lib/dates";

export const metadata: Metadata = { title: "Operations audit" };

function line(row: BookingSignal) {
  return (
    <p key={`${row.callId}-${row.signalType}-${row.evidence.slice(0, 24)}`}>
      <Link href={row.leadId ? `/operations/lead/${row.leadId}` : `/operations/call/${row.callId}`}>{row.lead || "Lead"}</Link>
      {" · "}appointment {row.appointmentAt ? formatStamp(row.appointmentAt) : "time unknown"}
      {" · "}booked {row.bookedAt ? formatStamp(row.bookedAt) : "date not stored"}
      {" · "}call {row.callId}
      {" · "}{row.signalType}
      {" · "}{row.speaker}: "{row.evidence}"
      {" · "}{row.action}
      {" · "}<Link href={`/operations/call/${row.callId}`}>Show evidence</Link>
    </p>
  );
}

export default function AuditPage() {
  const db = getDb();
  const ghl = readSyncState(db, "gohighlevel");
  const air = readSyncState(db, "aircall");
  const josh = joshBookingReport(db);
  const recovery = noShowRows(db);
  const confirmed = recovery.filter((row) => row.recovery_status === "CONFIRMED NO ATTEMPT").slice(0, 12);
  const pipeline = pipelineIssues(db);
  const rule = followUpRule(db);
  return (
    <>
      <header className="page-header">
        <p className="kicker">Operations</p>
        <h1>Daily audit</h1>
      </header>
      <p>GoHighLevel {healthLabel(ghl)}. Aircall {healthLabel(air)}.</p>
      <section className="section" id="josh">
        <h2>Josh appointment audit</h2>
        <p>Bookings {josh.bookings}. Booking conversations {josh.conversations}. Transcripts available {josh.transcripts}. Analysed {josh.analysed}. Unable to analyse {josh.unable}. Coverage {josh.coverage}.</p>
        <p>This starts from GoHighLevel bookings in the last 7 days where Josh called around the booking. It does not read every Josh call.</p>
        <h3>Lead attendance concerns</h3>
        {josh.lead.length ? josh.lead.map(line) : <p>No issues detected from the analysed bookings.</p>}
        <h3>Partner attendance concerns</h3>
        {josh.partner.length ? josh.partner.map(line) : <p>No issues detected from the analysed bookings.</p>}
        <h3>Both attendance concerns</h3>
        {josh.both.length ? josh.both.map(line) : <p>No issues detected from the analysed bookings.</p>}
        <h3>Reschedule / timing issues</h3>
        {josh.reschedule.length ? josh.reschedule.map(line) : <p>No issues detected from the analysed bookings.</p>}
        <h3>Current bring-forward opportunities</h3>
        {josh.bringForward.length ? josh.bringForward.map(line) : <p>No issues detected from the analysed bookings.</p>}
        <h3>Historical signals</h3>
        {josh.historical.length ? josh.historical.map(line) : <p>No past signals are stored for this window.</p>}
        <h3>Bookings not analysed</h3>
        {josh.unableRows.length ? josh.unableRows.map((row) => (
          <p key={`${row.leadId}-${row.bookedAt}`}>{row.lead || "Lead"} · booked {row.bookedAt ? formatStamp(row.bookedAt) : "date not stored"} · {row.reason}</p>
        )) : <p>No issues detected from the analysed bookings.</p>}
      </section>
      <section className="section">
        <h2>No-shows needing recovery</h2>
        {confirmed.length ? confirmed.map((row) => (
          <p key={`${row.lead_id}-${row.occurred_at}`}><Link href={row.lead_id ? `/operations/lead/${row.lead_id}` : "/operations"}>{row.name || "Lead"}</Link> · {row.source} · {row.occurred_at ? formatStamp(row.occurred_at) : "date not stored"} · {row.recovery_status}. Suggested owner: AP. Hayden required: no.</p>
        )) : <p>No issues detected from the available data.</p>}
        <p>{recovery.filter((row) => row.recovery_status === "UNKNOWN — INCOMPLETE DATA").length} no-show records are unknown because the stored calls do not cover the period after the event.</p>
      </section>
      <section className="section">
        <h2>Pipeline</h2>
        <p>{pipeline.bookedWithoutAppointment} leads are in a booked stage with no appointment stored. {pipeline.noShowStage} leads are in a no-show stage. {pipeline.duplicateContacts} contacts have more than one stored opportunity. GoHighLevel was not changed.</p>
      </section>
      <section className="section">
        <h2>Follow-up</h2>
        <p>{rule ? `${rule.title} is the stored rule.` : "No confirmed follow-up process is stored, so attempt gaps are not calculated."}</p>
      </section>
      <p className="quiet"><Link href="/operations">Back to Operations</Link></p>
    </>
  );
}
