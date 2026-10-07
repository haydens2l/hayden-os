import Link from "next/link";
import type { Agent, Campaign, Organisation, Person, Project } from "@/lib/db/types";

export function Empire({
  organisations,
  people,
  projects,
  campaigns,
  agents,
}: {
  organisations: Organisation[];
  people: Person[];
  projects: Project[];
  campaigns: Campaign[];
  agents: Agent[];
}) {
  const founder = people.find((person) => /founder/i.test(person.role ?? ""));
  const roots = organisations.filter((org) => !org.parent_id);
  const shared = agents.filter((agent) => !agent.organisation_id);

  return (
    <div>
      <p className="empire-root">
        {founder?.name ?? "Founder"}
        <span>{founder?.role ?? ""}</span>
      </p>
      <div className="empire">
        {roots.map((root) => {
          const ids = new Set([root.id, ...organisations.filter((org) => org.parent_id === root.id).map((org) => org.id)]);
          const brands = organisations.filter((org) => org.parent_id === root.id);
          const groupPeople = people.filter((person) => person.organisation_id && ids.has(person.organisation_id));
          const groupProjects = projects.filter((project) => project.organisation_id && ids.has(project.organisation_id) && project.status !== "completed");
          const groupCampaigns = campaigns.filter((campaign) => ids.has(campaign.organisation_id));
          const groupAgents = agents.filter((agent) => agent.organisation_id === root.id);
          return (
            <article className="empire-col" key={root.id}>
              <h3>
                <Link href={`/businesses/${root.id}`}>{root.name}</Link>
              </h3>
              <ul>
                {brands.map((brand) => (
                  <li key={brand.id}>
                    <Link href={`/businesses/${brand.id}`}>{brand.name}</Link>
                  </li>
                ))}
              </ul>
              <details>
                <summary>People · {groupPeople.length}</summary>
                <ul>
                  {groupPeople.map((person) => (
                    <li key={person.id}>
                      <Link href={`/team/${person.id}`}>
                        {person.name} · {person.role}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
              <details>
                <summary>Projects · {groupProjects.length}</summary>
                <ul>
                  {groupProjects.map((project) => (
                    <li key={project.id}>{project.name}</li>
                  ))}
                </ul>
              </details>
              <details>
                <summary>Campaigns · {groupCampaigns.length}</summary>
                <ul>
                  {groupCampaigns.map((campaign) => (
                    <li key={campaign.id}>
                      {campaign.name} · {campaign.status}
                    </li>
                  ))}
                </ul>
              </details>
              <details>
                <summary>Agents · {groupAgents.length}</summary>
                <ul>
                  {groupAgents.map((agent) => (
                    <li key={agent.id}>{agent.name}</li>
                  ))}
                </ul>
              </details>
            </article>
          );
        })}
      </div>
      {shared.length > 0 ? (
        <p className="shared-agents">{`Across the group: ${shared.map((agent) => `${agent.name} (${agent.status === "active" ? "active" : "not built"})`).join(", ")}.`}</p>
      ) : null}
    </div>
  );
}
