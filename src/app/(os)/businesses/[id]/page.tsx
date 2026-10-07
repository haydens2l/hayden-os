import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Status } from "@/components/ui/status";
import { formatShortDate } from "@/lib/dates";
import {
  listCampaignMetrics,
  listCampaigns,
  listIssues,
  listProjects,
  getOrganisation,
  listOrganisations,
  listPeople,
} from "@/lib/db/repository";

export const metadata: Metadata = { title: "Business" };

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organisation = getOrganisation(id);
  if (!organisation) notFound();

  const family = new Set([
    organisation.id,
    ...listOrganisations().filter((item) => item.parent_id === organisation.id).map((item) => item.id),
  ]);
  const people = listPeople().filter((person) => person.organisation_id && family.has(person.organisation_id));
  const projects = listProjects().filter((project) => project.organisation_id && family.has(project.organisation_id));
  const campaigns = listCampaigns().filter((campaign) => family.has(campaign.organisation_id));
  const issues = listIssues().filter((issue) => issue.organisation_id && family.has(issue.organisation_id));

  return (
    <>
      <PageHeader kicker={organisation.type} title={organisation.name} lede={organisation.description ?? undefined} />
      <p className="meta">
        {organisation.pulse_status ? <Status value={organisation.pulse_status} /> : <span>No performance figures are stored.</span>}
        <span>Owner {organisation.owner ?? "Unassigned"}</span>
      </p>
      {organisation.interpretation ? <p className="why">{organisation.interpretation}</p> : null}
      {organisation.notes ? <p className="quiet">{organisation.notes}</p> : null}
      {organisation.strategic_role ? (
        <section className="section">
          <h2>Strategy</h2>
          <p className="kicker">Manual · Founder provided · Priority {organisation.strategic_priority ?? "—"}</p>
          <p>{organisation.primary_objective}</p>
          <p>
            {organisation.strategic_role} · {organisation.growth_intent}
          </p>
          <p>Hayden — {organisation.hayden_role}</p>
          <p className="quiet">
            <Link href="/intelligence/brain">Correct this in the Business brain</Link>
          </p>
        </section>
      ) : null}

      <section className="section">
        <h2>People</h2>
        <div className="stack">
          {people.map((person) => (
            <Link key={person.id} href={`/team/${person.id}`} className="record">
              <h3>{person.name}</h3>
              <p>{person.role}</p>
            </Link>
          ))}
          {people.length === 0 ? <p className="quiet">No people are stored directly on this organisation.</p> : null}
        </div>
      </section>

      <section className="section">
        <h2>Projects</h2>
        <div className="stack">
          {projects.map((project) => (
            <div key={project.id} className="record">
              <h3>{project.name}</h3>
              <p>
                {project.status} · {project.owner_name ?? "Unassigned"} · {formatShortDate(project.due_date)}
              </p>
              <p>{project.next_action}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Campaigns</h2>
        <div className="stack">
          {campaigns.map((campaign) => {
            const metrics = listCampaignMetrics(campaign.id);
            const latest = metrics.at(-1);
            return (
              <div key={campaign.id} className="record">
                <h3>{campaign.name}</h3>
                <p>
                  {campaign.platform} · {campaign.status} · {campaign.audience}
                </p>
                <p>{campaign.offer}</p>
                {latest ? (
                  <p>
                    Latest stored day {formatShortDate(latest.date)}: CPL ${latest.cpl ?? "—"}, show rate{" "}
                    {latest.show_rate != null ? `${Math.round(latest.show_rate * 100)}%` : "—"}, leads {latest.leads ?? "—"}
                  </p>
                ) : (
                  <p>No daily metrics stored.</p>
                )}
                {campaign.notes ? <p>{campaign.notes}</p> : null}
              </div>
            );
          })}
          {campaigns.length === 0 ? <p className="quiet">No campaigns stored.</p> : null}
        </div>
      </section>

      <section className="section">
        <h2>Issues</h2>
        <div className="stack">
          {issues.map((issue) => (
            <div key={issue.id} className="record">
              <h3>{issue.title}</h3>
              <p>
                {issue.severity} · {issue.assignee_name ?? "Unassigned"} · {issue.requires_hayden ? "Needs you" : "With the team"}
              </p>
              <p>{issue.description}</p>
            </div>
          ))}
          {issues.length === 0 ? <p className="quiet">No open issues stored.</p> : null}
        </div>
      </section>
    </>
  );
}
