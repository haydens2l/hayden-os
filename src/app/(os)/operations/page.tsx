import type { Metadata } from "next";
import Link from "next/link";
import { addManualAppointmentAction, confirmShowRateAction, createFindingWorkAction, saveOperationsTarget, syncLiveOperationsAction } from "@/lib/actions";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { listOrganisations } from "@/lib/db/repository";
import { dataQuality } from "@/lib/ops/analyse";
import { capabilityRecords } from "@/lib/ops/capabilities";
import { connectorStatus } from "@/lib/ops/connectors";
import { listOpsFindings } from "@/lib/ops/findings";
import { definitionFor, KPI_CATALOG } from "@/lib/ops/kpis";
import { joshBookingReport } from "@/lib/ops/booking";
import { noShowRows } from "@/lib/ops/noshow";
import { healthLabel, readSyncState } from "@/lib/ops/sync-state";
import { followUpRule, pipelineIssues, setterActivity } from "@/lib/ops/live";
import { formatStamp } from "@/lib/dates";

export const metadata: Metadata = { title: "Operations" };

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const db = getDb();
  const organisations = listOrganisations();
  const today = new Date().toISOString().slice(0, 10);
  const findings = listOpsFindings(db);
  const any = db.prepare(`SELECT COUNT(*) AS n FROM ops_appointments`).get() as { n: number };
  const ghl = readSyncState(db, "gohighlevel");
  const air = readSyncState(db, "aircall");
  const audit = joshBookingReport(db);
  const recovery = noShowRows(db);
  const confirmed = recovery.filter((row) => row.recovery_status === "CONFIRMED NO ATTEMPT");
  const unknown = recovery.filter((row) => row.recovery_status === "UNKNOWN — INCOMPLETE DATA");

  return (
    <>
      <PageHeader
        kicker="Operations"
        title="What is happening"
        lede="This reads Aircall and GoHighLevel. It does not change them. Attention comes first. Nothing here is estimated."
      />
      <p className="lede">
        <Link href="/operations/audit">Daily audit</Link>
        {" · "}
        <Link href="/operations/audit#josh">Josh appointment audit</Link>
        {" · "}
        <Link href="/operations/brief">Operations brief</Link>
      </p>
      <section className="section">
        <h2>Data health</h2>
        <p>GoHighLevel: {healthLabel(ghl)}. Last sync {ghl.lastSuccessfulAt ? formatStamp(ghl.lastSuccessfulAt) : "has not happened"}. Latest record {ghl.latestSourceAt ? formatStamp(ghl.latestSourceAt) : "not stored"}.</p>
        <p>Aircall: {healthLabel(air)}. Last sync {air.lastSuccessfulAt ? formatStamp(air.lastSuccessfulAt) : "has not happened"}. Latest call {air.latestSourceAt ? formatStamp(air.latestSourceAt) : "not stored"}.</p>
        <p>Josh booking audit: {audit.coverage}. {audit.unable ? `${audit.unable} could not be analysed.` : "Every reviewed booking was analysed."}</p>
        <p>No-show recovery: {confirmed.length} confirmed with no call after the event. {unknown.length} unknown because call coverage does not include them.{air.latestSourceAt ? ` Calls are stored through ${formatStamp(air.latestSourceAt)}.` : ""}</p>
        {ghl.error || air.error ? <p>{ghl.error || air.error}</p> : null}
      </section>
      <section className="section">
        <h2>What needs attention</h2>
        {notice ? <p className="why">{notice}</p> : null}
        <p>{audit.lead.length} lead attendance concerns, {audit.partner.length} partner issues, and {audit.bringForward.length} bring-forward opportunities on upcoming appointments.</p>
        <p>{confirmed.length} no-shows have coverage and no recovery call. Booked stage with no appointment: {pipelineIssues(db).bookedWithoutAppointment}. Follow-up rule: {followUpRule(db) ? followUpRule(db)?.title : "No confirmed follow-up process is stored, so attempt gaps are not calculated."}</p>
        <form action={syncLiveOperationsAction}>
          <button className="decision-button" type="submit">Sync live data</button>
        </form>
        <h3>Upcoming appointment concerns</h3>
        {audit.lead.length + audit.both.length + audit.reschedule.length ? [...audit.lead, ...audit.both, ...audit.reschedule].map((row) => (
          <p key={`${row.callId}-${row.signalType}`}>{row.lead || "Lead"} · {row.appointmentAt || "time unknown"} · {row.signalType} · "{row.evidence}" · <Link href={`/operations/call/${row.callId}`}>Show evidence</Link></p>
        )) : <p>No issues detected from the analysed upcoming bookings.</p>}
        <h3>Partner issues</h3>
        {audit.partner.length ? audit.partner.map((row) => (
          <p key={`${row.callId}-partner`}>{row.lead || "Lead"} · {row.appointmentAt || "time unknown"} · "{row.evidence}" · {row.action}</p>
        )) : <p>No issues detected from the analysed upcoming bookings.</p>}
        <h3>Bring-forward opportunities</h3>
        {audit.bringForward.length ? audit.bringForward.map((row) => (
          <p key={`${row.callId}-forward`}>{row.lead || "Lead"} · {row.appointmentAt || "time unknown"} · "{row.evidence}". An earlier slot is not confirmed.</p>
        )) : <p>No issues detected from the analysed upcoming bookings.</p>}
        <h3>No-show recovery</h3>
        {confirmed.slice(0, 8).map((row) => (
          <p key={`${row.lead_id}-${row.occurred_at}`}>{row.name || "Lead"} · {row.source} · {row.occurred_at ? formatStamp(row.occurred_at) : "date not stored"} · {row.recovery_status}</p>
        ))}
        {!confirmed.length ? <p>No confirmed untouched no-show is in the covered period.</p> : null}
        <h3>Calls</h3>
        {setterActivity(db).slice(0, 6).map((row) => (
          <p key={row.name}>{row.name}: {row.calls} calls, {row.connected} answered. Talk time {row.talk_seconds ? `${Math.round(row.talk_seconds / 60)} minutes` : "not stored on this pull"}.</p>
        ))}
      </section>
      {any.n === 0 ? <p>No appointments are stored yet. Calls and pipeline leads are stored separately.</p> : null}
      {organisations.map((org) => {
        const quality = dataQuality(db, org.id, today);
        const show = definitionFor(db, org.id, "show_rate");
        const count = db.prepare(`SELECT COUNT(*) AS n FROM ops_appointments WHERE organisation_id = ?`).get(org.id) as { n: number };
        if (count.n === 0 && quality.every((item) => item.state === "missing")) return null;
        return (
          <section className="section" key={org.id}>
            <h2>{org.name}</h2>
            {quality.map((item) => (
              <p key={item.name}>
                {item.name}: {item.state}. {item.detail}
              </p>
            ))}
            {count.n > 0 && show?.status !== "confirmed" ? (
              <form action={confirmShowRateAction}>
                <input type="hidden" name="organisationId" value={org.id} />
                <p>Show rate formula waiting for confirmation: appointments sat / appointments expected to occur. Expected means sat, no-show, or cancelled.</p>
                <button className="decision-button decision-approve" type="submit">
                  Use this formula
                </button>
              </form>
            ) : null}
          </section>
        );
      })}
      <section className="section">
        <h2>Findings</h2>
        {findings.length === 0 ? <p className="quiet">No operational findings are stored.</p> : null}
        {findings.map((finding) => (
          <article key={finding.id}>
            <p className="kicker">{finding.severity}</p>
            <h3>{finding.what_happened}</h3>
            <p>{finding.evidence}</p>
            <p>{finding.possible_causes}</p>
            <p className="quiet">{finding.hayden_required ? "Needs you." : "Does not need you."}</p>
            {finding.task_id ? <p>Already in Work.</p> : (
              <form action={createFindingWorkAction}>
                <input type="hidden" name="findingId" value={finding.id} />
                <button className="decision-button" type="submit">
                  Turn into work
                </button>
              </form>
            )}
          </article>
        ))}
      </section>
      <section className="section">
        <h2>Add one appointment</h2>
        <form className="brain-form" action={addManualAppointmentAction}>
          <label>
            Business
            <select name="organisationId">
              {organisations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input name="scheduledAt" placeholder="2026-10-01" required />
          </label>
          <label>
            Status
            <input name="status" placeholder="sat, no-show, cancelled, booked" required />
          </label>
          <label>
            Setter
            <input name="setterName" />
          </label>
          <label>
            Transcript evidence, if you have the words
            <textarea name="evidence" />
          </label>
          <input type="hidden" name="evidenceType" value="transcript" />
          <button className="decision-button" type="submit">
            Store appointment
          </button>
        </form>
      </section>
      <section className="section">
        <h2>Store a target</h2>
        <p className="quiet">Leave this blank unless you already know the number. Hayden OS will not fill one in.</p>
        <form className="brain-form" action={saveOperationsTarget}>
          <label>
            Business
            <select name="organisationId">
              {organisations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            KPI
            <select name="kpiKey">
              {KPI_CATALOG.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Scope
            <select name="scopeType" defaultValue="organisation">
              <option value="organisation">Business</option>
              <option value="team">Team</option>
              <option value="person">Person</option>
              <option value="campaign">Campaign</option>
              <option value="role">Role</option>
            </select>
          </label>
          <label>
            Who or what
            <input name="scopeLabel" placeholder="FIFO Investor, or a person's name" required />
          </label>
          <label>
            Period
            <input name="periodLabel" placeholder="Weekly" required />
          </label>
          <label>
            Target
            <input name="targetValue" type="number" step="0.1" required />
          </label>
          <label>
            Unit
            <select name="targetUnit">
              <option value="percent">Percent</option>
              <option value="count">Count</option>
            </select>
          </label>
          <label>
            Where this number came from
            <input name="sourceName" placeholder="Hayden, or the document name" required />
          </label>
          <button className="decision-button" type="submit">
            Store target
          </button>
        </form>
      </section>
      <section className="section">
        <h2>Sources</h2>
        {connectorStatus(db).map((connector) => (
          <p key={connector.id}>
            {connector.href ? <Link href={connector.href}>{connector.name}</Link> : connector.name}: {connector.connected ? "Connected. " : ""}
            {connector.reason}
          </p>
        ))}
        {capabilityRecords(db).map((row) => (
          <p key={`${row.integration}-${row.capability}`}>{row.integration} {row.capability}: {row.access}. {row.detail}</p>
        ))}
      </section>
    </>
  );
}
