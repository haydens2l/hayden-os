import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { listWork, projectStageCounts } from "@/lib/work/state";
import { listProjects } from "@/lib/db/repository";

export const metadata: Metadata = { title: "Work" };

const FILTERS = [
  ["all", "All"],
  ["hayden", "Mine"],
  ["lily", "Lily"],
  ["danny", "Danny"],
  ["ap", "AP"],
  ["nic", "Nic"],
  ["ai", "AI"],
] as const;

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const { who } = await searchParams;
  const filter = FILTERS.some((item) => item[0] === who) ? who! : "all";
  const db = getDb();
  const items = listWork(db).filter((row) => {
    if (row.stage === "CANCELLED") return false;
    if (filter === "all") return true;
    if (filter === "ai") return row.ownerType === "ai";
    if (filter === "hayden") return row.ownerId === "hayden";
    return row.ownerId === filter;
  });
  const projects = listProjects()
    .map((project) => ({ project, counts: projectStageCounts(db, project.id) }))
    .filter((row) => row.counts);

  return (
    <>
      <PageHeader
        kicker="Work"
        title="Execution"
        lede="Who owns it, what stage it is at, and whether you are needed. This is not Today."
      />
      <nav className="examples" aria-label="Work filters">
        {FILTERS.map(([id, label]) => (
          <Link key={id} href={id === "all" ? "/work" : `/work?who=${id}`} data-active={filter === id}>
            {label}
          </Link>
        ))}
      </nav>
      <section className="section">
        {items.length === 0 ? <p className="quiet">Nothing stored for this filter.</p> : null}
        <div className="stack">
          {items.map((row) => (
            <article className="card" key={row.id}>
              <p className="kicker">{row.organisation ?? "Unassigned"}</p>
              <h2>
                <Link href={row.href}>{row.title}</Link>
              </h2>
              <p>
                {row.ownerName ?? "Unassigned"} · {row.stage}
              </p>
              <p>{row.nextAction}</p>
              {row.blockedReason ? <p>Blocked: {row.blockedReason}</p> : null}
              <p className="quiet">{row.haydenRequired ? `Needs you. ${row.haydenAction}` : "Does not need you."}</p>
            </article>
          ))}
        </div>
      </section>
      {projects.length ? (
        <section className="section">
          <p className="kicker">Project counts</p>
          {projects.map(({ project, counts }) => (
            <p key={project.id}>
              {project.name}: {counts}
            </p>
          ))}
        </section>
      ) : null}
    </>
  );
}
