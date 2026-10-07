import type { Metadata } from "next";
import Link from "next/link";
import { proposeCustomStyle } from "@/lib/actions";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Style library" };

export default async function StyleLibraryPage({ searchParams }: { searchParams: Promise<{ family?: string }> }) {
  const filters = await searchParams;
  const db = getDb();
  const styles = db.prepare(`SELECT s.id, s.name, s.description, s.family, s.visual_medium, s.status, r.status AS reference_status FROM style_templates s LEFT JOIN style_references r ON r.style_id = s.id WHERE s.status != 'archived' ${filters.family ? "AND s.family = ?" : ""} ORDER BY s.name`).all(...(filters.family ? [filters.family] : [])) as Array<{
    id: string;
    name: string;
    description: string;
    family: string;
    visual_medium: string | null;
    status: string;
    reference_status: string | null;
  }>;
  const families = ["ALL", "PHYSICAL", "LIVE ACTION", "ILLUSTRATION", "3D", "GRAPHIC", "CUSTOM"];

  return (
    <article>
      <header className="page-header">
        <p className="kicker">Content</p>
        <h1>Style library</h1>
        <p className="lede">Approved looks. A style without its reference image says so. Nothing here is a fake stand-in.</p>
        <p className="row-actions">
          {families.map((family) => (
            <Link key={family} href={family === "ALL" ? "/production/styles" : `/production/styles?family=${encodeURIComponent(family)}`}>{family}</Link>
          ))}
        </p>
      </header>
      {styles.map((style) => (
        <section className="card" key={style.id}>
          <p className="kicker">{style.reference_status === "required" || !style.reference_status ? "REFERENCE REQUIRED" : style.reference_status} · {style.status}</p>
          <h2><Link href={`/production/styles/${style.id}`}>{style.name}</Link></h2>
          <p>{style.description}</p>
          <p className="quiet">{style.visual_medium}. {style.family}</p>
        </section>
      ))}
      <section>
        <h2>Create a style from a reference</h2>
        <p className="quiet">This stays proposed until you approve it. It does not enter the library as a finished style on its own.</p>
        <form action={proposeCustomStyle}>
          <input name="name" placeholder="Style name" />
          <textarea name="note" rows={4} placeholder="What the reference looks like" />
          <button type="submit">Propose style</button>
        </form>
      </section>
    </article>
  );
}
