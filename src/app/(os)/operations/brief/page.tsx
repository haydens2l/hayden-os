import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { listOrganisations } from "@/lib/db/repository";
import { operationsBrief } from "@/lib/ops/brief";

export const metadata: Metadata = { title: "Operations brief" };

export default async function OperationsBriefPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const db = getDb();
  const organisations = listOrganisations();
  const selected = organisations.find((item) => item.id === org) ?? null;
  const range = selected
    ? (db.prepare(`SELECT MIN(scheduled_at) AS start, MAX(scheduled_at) AS end FROM ops_appointments WHERE organisation_id = ?`).get(selected.id) as { start: string | null; end: string | null })
    : null;
  const brief = selected && range?.start && range.end ? operationsBrief(db, selected.id, selected.name, range.start, range.end) : null;

  return (
    <>
      <PageHeader kicker="Operations" title="Operations brief" lede="Ask for this when you want it. It is not added to the morning list." />
      <nav className="examples" aria-label="Businesses">
        {organisations.map((item) => (
          <Link key={item.id} href={`/operations/brief?org=${item.id}`}>
            {item.name}
          </Link>
        ))}
      </nav>
      {!selected ? <p>Choose a business.</p> : null}
      {brief ? (
        <>
          <p>{brief.headline}</p>
          {brief.sections.map((section) => (
            <section className="section" key={section.title}>
              <h2>{section.title}</h2>
              {section.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </section>
          ))}
        </>
      ) : selected ? (
        <p>No operational data is stored for {selected.name}.</p>
      ) : null}
    </>
  );
}