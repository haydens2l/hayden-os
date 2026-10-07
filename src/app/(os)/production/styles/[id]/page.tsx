import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveCustomStyle, archiveStyle, duplicateStyle } from "@/lib/actions";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Style" };

export default async function StyleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const style = db.prepare(`SELECT * FROM style_templates WHERE id = ?`).get(id) as
    | {
        id: string;
        name: string;
        description: string;
        status: string;
        visual_medium: string | null;
        prompt_recipe: string | null;
        negative_constraints: string | null;
        recommended_use: string | null;
        known_weaknesses: string | null;
        material_language: string | null;
        character_language: string | null;
        lighting_philosophy: string | null;
        continuity_rules: string | null;
      }
    | undefined;
  if (!style) notFound();
  const references = db.prepare(`SELECT purpose, status, note FROM style_references WHERE style_id = ?`).all(id) as Array<{ purpose: string; status: string; note: string | null }>;

  return (
    <article>
      <header className="page-header">
        <p className="kicker">{style.status}</p>
        <h1>{style.name}</h1>
        <p className="lede">{style.description}</p>
        <p className="row-actions"><Link href="/production/styles">Style library</Link></p>
      </header>
      {references.length === 0 || references.some((item) => item.status === "required") ? <p>REFERENCE REQUIRED. No approved reference image is attached.</p> : null}
      <p>{style.visual_medium}</p>
      <p>{style.material_language}</p>
      <p>{style.character_language}</p>
      <p>{style.lighting_philosophy}</p>
      <p>{style.continuity_rules}</p>
      <h2>Prompt recipe</h2>
      <p>{style.prompt_recipe}</p>
      <h2>Do not</h2>
      <p>{style.negative_constraints}</p>
      <p className="quiet">{style.recommended_use} {style.known_weaknesses}</p>
      <form action={duplicateStyle}><input type="hidden" name="styleId" value={style.id} /><button type="submit">Duplicate style</button></form>
      <form action={archiveStyle}><input type="hidden" name="styleId" value={style.id} /><button type="submit">Archive</button></form>
      {style.status === "proposed" ? (
        <form action={approveCustomStyle}><input type="hidden" name="styleId" value={style.id} /><button type="submit">Save to style library</button></form>
      ) : null}
    </article>
  );
}
