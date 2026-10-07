import type { Metadata } from "next";
import Link from "next/link";
import { linkDriveToProject, promoteDriveToBrain } from "@/lib/actions";
import { getDb } from "@/lib/db/client";
import { listOrganisations, listProjects } from "@/lib/db/repository";
import { KNOWLEDGE_CATEGORIES } from "@/lib/integrations/google-drive/classify";
import { excerptFor, searchDriveFiles } from "@/lib/integrations/google-drive/store";
import { formatShortDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; organisation?: string; brand?: string; category?: string; mime?: string; modified?: string; source?: string }>;
}) {
  const filters = await searchParams;
  const db = getDb();
  const results =
    filters.source && filters.source !== "drive"
      ? []
      : searchDriveFiles(db, {
          query: filters.q,
          organisationId: filters.organisation,
          brand: filters.brand,
          category: filters.category,
          mime: filters.mime,
          modifiedAfter: filters.modified,
        });
  const organisations = listOrganisations();
  const projects = listProjects();

  return (
    <>
      <header className="page-header">
        <p className="kicker">Intelligence</p>
        <h1>Knowledge</h1>
        <p className="lede">Drive documents stay documents. Nothing here rewrites the Business brain unless you approve it.</p>
      </header>
      <form className="command-form" action="/intelligence/knowledge" method="get">
        <label className="sr-only" htmlFor="knowledge-q">
          Search business knowledge
        </label>
        <input id="knowledge-q" name="q" defaultValue={filters.q ?? ""} placeholder="Search business knowledge..." />
        <div className="row-actions">
          <select name="organisation" className="delegate-select" defaultValue={filters.organisation ?? ""}>
            <option value="">Organisation</option>
            {organisations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          <select name="brand" className="delegate-select" defaultValue={filters.brand ?? ""}>
            <option value="">Brand</option>
            {organisations
              .filter((org) => org.type === "brand")
              .map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
          </select>
          <select name="source" className="delegate-select" defaultValue={filters.source ?? ""}>
            <option value="">Source</option>
            <option value="drive">Google Drive</option>
          </select>
          <select name="category" className="delegate-select" defaultValue={filters.category ?? ""}>
            <option value="">Category</option>
            {KNOWLEDGE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <select name="mime" className="delegate-select" defaultValue={filters.mime ?? ""}>
            <option value="">File type</option>
            <option value="document">Google Doc</option>
            <option value="spreadsheet">Google Sheet</option>
            <option value="pdf">PDF</option>
            <option value="wordprocessingml">DOCX</option>
            <option value="text/plain">Text</option>
            <option value="csv">CSV</option>
          </select>
          <input className="tiny-input" name="modified" type="date" defaultValue={filters.modified ?? ""} />
          <button className="text-button" type="submit">
            Search
          </button>
        </div>
      </form>
      <section className="section">
        {results.length === 0 ? <p className="quiet">No indexed document matches.</p> : null}
        <div className="stack">
          {results.map(({ row }) => (
            <article className="record" key={row.id}>
              <p className="kicker">
                {row.organisation_name ?? "Unknown"} · {row.knowledge_category ?? "UNKNOWN"} · {formatShortDate(row.modified_time)}
              </p>
              <h3>{row.name}</h3>
              <p>{excerptFor(row, filters.q ?? "")}</p>
              {row.web_url ? (
                <p>
                  <a href={row.web_url} target="_blank" rel="noreferrer">
                    Open in Drive
                  </a>
                </p>
              ) : null}
              <form action={promoteDriveToBrain} className="brain-form">
                <input type="hidden" name="fileId" value={row.id} />
                <input type="hidden" name="approved" value="yes" />
                <label>
                  Title
                  <input name="title" defaultValue={row.name} />
                </label>
                <label>
                  Proposed knowledge
                  <textarea name="content" rows={4} defaultValue={excerptFor(row, filters.q ?? "")} />
                </label>
                <label>
                  Save as
                  <select name="contextType" defaultValue="HISTORICAL">
                    <option value="FACT">Fact</option>
                    <option value="STRATEGY">Strategy</option>
                    <option value="PREFERENCE">Preference</option>
                    <option value="DECISION">Decision</option>
                    <option value="HYPOTHESIS">Hypothesis</option>
                    <option value="HISTORICAL">Historical</option>
                  </select>
                </label>
                <button className="text-button" type="submit">
                  Add to Business brain
                </button>
              </form>
              {projects.length > 0 ? (
                <form action={linkDriveToProject} className="row-actions">
                  <input type="hidden" name="fileId" value={row.id} />
                  <input type="hidden" name="label" value={row.name} />
                  <input type="hidden" name="webUrl" value={row.web_url ?? ""} />
                  <select name="projectId" className="delegate-select" defaultValue={projects[0]?.id}>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <button className="text-button" type="submit">
                    Link to project
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      <p className="quiet">
        <Link href="/intelligence">Back to Intelligence</Link>
      </p>
    </>
  );
}
