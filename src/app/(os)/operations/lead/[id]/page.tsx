import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { readSecret } from "@/lib/integrations/connections";
import type { GhlSecret } from "@/lib/integrations/ghl/sync";
import { leadTimeline } from "@/lib/ops/live";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const lead = db.prepare(`SELECT * FROM ops_leads WHERE id = ?`).get(id) as Record<string, string | null> | undefined;
  if (!lead) notFound();
  const organisation = db.prepare(`SELECT name FROM organisations WHERE id = ?`).get(lead.organisation_id) as { name: string } | undefined;
  const appointment = db.prepare(`SELECT scheduled_at, status, setter_name, campaign_name, external_id FROM ops_appointments WHERE lead_id = ? ORDER BY scheduled_at DESC LIMIT 1`).get(id) as { scheduled_at: string | null; status: string; setter_name: string | null; campaign_name: string | null; external_id: string | null } | undefined;
  const signals = db.prepare(`SELECT signal_type, speaker, evidence, call_external_id, occurred_at FROM ops_signals WHERE lead_id = ? ORDER BY occurred_at DESC`).all(id) as Array<{ signal_type: string; speaker: string | null; evidence: string; call_external_id: string; occurred_at: string | null }>;
  const calls = db.prepare(`SELECT external_id, actor_name, outcome, occurred_at, source_url FROM ops_activities WHERE lead_id = ? OR person_id = ? ORDER BY occurred_at DESC LIMIT 8`).all(id, lead.person_id) as Array<{ external_id: string; actor_name: string | null; outcome: string | null; occurred_at: string | null; source_url: string | null }>;
  const secret = readSecret<GhlSecret>(db, "gohighlevel");
  const ghlHref = secret && lead.contact_external_id ? `https://app.gohighlevel.com/v2/location/${secret.locationId}/contacts/detail/${lead.contact_external_id}` : null;
  return (
    <>
      <header className="page-header">
        <p className="kicker">{organisation?.name}</p>
        <h1>{lead.name || "Unnamed lead"}</h1>
      </header>
      <section className="section">
        <p>Pipeline: {lead.pipeline_name || lead.source_name || "Not stored"} · {lead.stage || "Stage not stored"}</p>
        <p>Owner: {lead.owner_name || "Not stored"}</p>
        <p>Appointment: {appointment ? `${appointment.scheduled_at || "time unknown"} · ${appointment.status} · ${appointment.setter_name || "owner not stored"} · ${appointment.campaign_name || ""}` : "No appointment stored"}</p>
        <p>Lead source: {lead.lead_source || "Not stored"}</p>
        {ghlHref ? <p><a href={ghlHref}>Open the GoHighLevel contact</a></p> : null}
        {lead.external_id ? <p>Opportunity id: {lead.external_id}</p> : null}
      </section>
      <section className="section">
        <h2>Timeline</h2>
        {leadTimeline(db, id).map((event) => (
          <p key={`${event.at}-${event.label}`}>{event.at.slice(0, 16).replace("T", " ")} · {event.label} · {event.source}</p>
        ))}
      </section>
      <section className="section">
        <h2>Calls</h2>
        {calls.length ? calls.map((call) => (
          <p key={call.external_id}>{call.occurred_at?.slice(0, 16).replace("T", " ")} · {call.actor_name} · {call.outcome} · <Link href={`/operations/call/${call.external_id}`}>Evidence</Link>{call.source_url ? <> · <a href={call.source_url}>Aircall record</a></> : null}</p>
        )) : <p>No matched call is stored.</p>}
      </section>
      <section className="section">
        <h2>Signals</h2>
        {signals.length ? signals.map((signal) => (
          <p key={`${signal.call_external_id}-${signal.signal_type}`}>{signal.signal_type} · {signal.speaker}: "{signal.evidence}" · <Link href={`/operations/call/${signal.call_external_id}`}>Show evidence</Link></p>
        )) : <p>No operational signal is stored for this lead.</p>}
      </section>
      <p className="quiet"><Link href="/operations">Back to Operations</Link></p>
    </>
  );
}
