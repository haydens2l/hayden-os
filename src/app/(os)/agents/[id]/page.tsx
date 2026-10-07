import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { handoffWork, sendToContentFactory, startVisualDirection } from "@/lib/actions";
import { PendingButton } from "@/components/shell/pending-button";
import { formatStamp } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { listConcepts, listFormats, listJobs } from "@/lib/team/work";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const db = getDb();
  const agent = db.prepare(`SELECT id, name, mandate, status FROM agents WHERE id = ?`).get(id) as
    | { id: string; name: string; mandate: string; status: string }
    | undefined;
  if (!agent) notFound();
  const jobs = listJobs(db, agent.id);
  const concepts = agent.id === "creative" ? listConcepts(db) : [];
  const formats = agent.id === "media" ? listFormats(db) : [];

  return (
    <>
      <header className="page-header">
        <p className="kicker">{agent.status === "active" ? "Inbox" : "Not built"}</p>
        <h1>{agent.name}</h1>
        <p className="lede">{agent.mandate}</p>
      </header>
      {agent.id === "visual" ? (
        <section className="section">
          <h2>Needs visual direction</h2>
          <p className="lede">Approved concepts only. The Visual Director cannot change the locked medium.</p>
          <div className="stack">
            {(db.prepare(`SELECT id, title, brand FROM creative_concepts WHERE status = 'approved' ORDER BY approved_at DESC LIMIT 8`).all() as Array<{ id: string; title: string; brand: string | null }>).map((concept) => (
              <article className="record" key={concept.id}>
                <p className="kicker">{concept.brand ?? "UNKNOWN BRAND"}</p>
                <h3>{concept.title}</h3>
                <form action={startVisualDirection}>
                  <input type="hidden" name="conceptId" value={concept.id} />
                  <button className="decision-button decision-approve" type="submit">Create visual direction</button>
                </form>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {concepts.some((concept) => concept.status === "approved") ? (
        <section className="section">
          <h2>Approved</h2>
          <p className="lede">These are saved. Send one to Content Factory to build the production pack. It can take a couple of minutes. The button stays on Building the pack… until it finishes.</p>
          {notice ? <p className="why">{notice}</p> : null}
          <div className="stack">
            {concepts
              .filter((concept) => concept.status === "approved")
              .map((concept) => (
                <article className="record" key={concept.id}>
                  <p className="kicker">approved · {concept.brand ?? "Unassigned"}</p>
                  <h3>{concept.title}</h3>
                  <p>{concept.hook}</p>
                  <form action={sendToContentFactory}>
                    <input type="hidden" name="conceptId" value={concept.id} />
                    <PendingButton label="Send to Content Factory" pendingLabel="Building the pack…" />
                  </form>
                </article>
              ))}
          </div>
        </section>
      ) : null}
      {agent.status === "active" && agent.id !== "chief-of-staff" ? (
        <form action={handoffWork} className="stack">
          <p className="kicker">Request work from another agent</p>
          <input type="hidden" name="fromAgentId" value={agent.id} />
          <input type="hidden" name="next" value={`/agents/${agent.id}`} />
          <textarea name="objective" rows={3} placeholder="Develop three executions of this format." />
          <div className="row-actions">
            <select name="toAgentId" className="delegate-select" defaultValue={agent.id === "media" ? "creative" : agent.id === "creative" ? "content" : "growth"}>
              {["creative", "growth", "media", "content"]
                .filter((seat) => seat !== agent.id)
                .map((seat) => (
                  <option key={seat} value={seat}>
                    {seat}
                  </option>
                ))}
            </select>
            <button className="text-button" type="submit">
              Send request
            </button>
          </div>
        </form>
      ) : null}
      <section className="section">
        <h2>Work</h2>
        {jobs.length === 0 ? <p className="quiet">No jobs yet.</p> : null}
        <div className="stack">
          {jobs.map((job) => (
            <article className="record" key={job.id}>
              <p className="kicker">
                {job.status} · requested by {job.requested_by_label ?? job.requested_by} · {formatStamp(job.completed_at ?? job.created_at)}
              </p>
              <h3>{job.title}</h3>
              <p>{job.output_summary ?? job.objective}</p>
            </article>
          ))}
        </div>
      </section>
      {concepts.length > 0 ? (
        <section className="section">
          <h2>For your review</h2>
          {concepts.filter((concept) => concept.status === "shortlisted").length === 0 ? <p className="quiet">Nothing is waiting on you here.</p> : null}
          <div className="stack">
            {concepts
              .filter((concept) => concept.status === "shortlisted")
              .map((concept) => (
                <article className="record" key={concept.id}>
                  <p className="kicker">
                    {concept.status} · {concept.brand ?? "Unassigned"}
                  </p>
                  <h3>{concept.title}</h3>
                  <p>{concept.hook}</p>
                </article>
              ))}
          </div>
          <h2>Creative library</h2>
          <p className="quiet">Stored concepts that are not on your review list.</p>
          <div className="stack">
            {concepts
              .filter((concept) => concept.status !== "shortlisted")
              .map((concept) => (
              <article className="record" key={concept.id}>
                <p className="kicker">
                  {concept.status} · {concept.brand ?? "Unassigned"}
                </p>
                <h3>{concept.title}</h3>
                <p>{concept.hook}</p>
                {concept.status === "approved" ? (
                  <form action={sendToContentFactory}>
                    <input type="hidden" name="conceptId" value={concept.id} />
                    <PendingButton label="Send to Content Factory" pendingLabel="Building the pack…" />
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {formats.length > 0 ? (
        <section className="section">
          <h2>Format ideas</h2>
          <div className="stack">
            {formats.map((format) => (
              <article className="record" key={format.id}>
                <p className="kicker">
                  {format.status} · {format.brand ?? "Unassigned"}
                </p>
                <h3>{format.name}</h3>
                <p>{format.description}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <p className="quiet">
        <Link href="/agents">Back to AI Team</Link>
      </p>
    </>
  );
}
