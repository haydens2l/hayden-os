import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveContentConcept, lockContentScript, requestStoryboardPass, saveScriptEdit } from "@/lib/actions";
import { nextStep } from "@/lib/content/workflow";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Content" };

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const item = db.prepare(`SELECT * FROM content_items WHERE id = ?`).get(id) as
    | {
        id: string;
        brand: string | null;
        title: string | null;
        stage: string;
        rough_idea: string | null;
        concept_id: string | null;
        legacy_pack_id: string | null;
      }
    | undefined;
  if (!item) notFound();
  const step = nextStep(item.stage);
  const concept = item.concept_id
    ? (db.prepare(`SELECT title, hook, concept, status, cta, notes, why_it_may_work FROM creative_concepts WHERE id = ?`).get(item.concept_id) as
        | { title: string; hook: string | null; concept: string | null; status: string; cta: string | null; notes: string | null; why_it_may_work: string | null }
        | undefined)
    : undefined;
  let extra: { entertainment?: string; story?: string; characters?: string; emotionalArc?: string; audioMode?: string } = {};
  try {
    extra = concept?.notes ? (JSON.parse(concept.notes) as typeof extra) : {};
  } catch {
    extra = {};
  }
  const script = db.prepare(`SELECT audio_mode, spoken, voiceover, on_screen, estimated_seconds, structure_json, quality_notes, status FROM content_scripts WHERE content_id = ? ORDER BY version DESC LIMIT 1`).get(id) as
    | { audio_mode: string | null; spoken: string | null; voiceover: string | null; on_screen: string | null; estimated_seconds: number | null; structure_json: string | null; quality_notes: string | null; status: string }
    | undefined;
  const style = db.prepare(`SELECT t.name FROM style_locks l JOIN style_templates t ON t.id = l.style_id WHERE l.content_id = ? ORDER BY l.version DESC LIMIT 1`).get(id) as { name: string } | undefined;
  const pack = db.prepare(`SELECT id FROM production_packs WHERE creative_concept_id = ?`).get(item.concept_id) as { id: string } | undefined;

  return (
    <article>
      <header className="page-header">
        <p className="kicker">{item.brand}</p>
        <h1>{item.title}</h1>
        <p className="lede">Stage: {item.stage.replaceAll("_", " ")}. Waiting on {step.waiting}. Next: {step.action}. Owner: {step.owner}.</p>
        <p className="row-actions">
          <Link href="/production">Content</Link>
          {item.stage === "STYLE_SELECTION" || item.stage === "SCRIPT_LOCKED" ? <Link href={`/production/content/${id}/look`}>Choose the look</Link> : null}
          <Link href={`/production/content/${id}/board`}>Storyboard sheet</Link>
          {item.legacy_pack_id ? <Link href={`/production/${item.legacy_pack_id}`}>Legacy pack</Link> : null}
        </p>
      </header>
      <section>
        <h2>Idea</h2>
        <p>{item.rough_idea}</p>
      </section>
      <section>
        <h2>Concept</h2>
        {concept ? (
          <>
            <p>{concept.hook}</p>
            <p>{concept.concept}</p>
            {extra.entertainment ? <p>Entertainment: {extra.entertainment}</p> : null}
            {extra.story ? <p>{extra.story}</p> : null}
            {extra.characters ? <p>Characters: {extra.characters}</p> : null}
            {concept.why_it_may_work ? <p className="quiet">{concept.why_it_may_work}</p> : null}
            <p className="quiet">Status: {concept.status}. CTA: {concept.cta}</p>
            {concept.status !== "approved" ? (
              <form action={approveContentConcept}>
                <input type="hidden" name="contentId" value={id} />
                <button type="submit">Approve concept</button>
              </form>
            ) : null}
          </>
        ) : (
          <p className="quiet">No concept yet.</p>
        )}
      </section>
      <section>
        <h2>Script</h2>
        {script ? (
          <>
            <p className="quiet">{script.audio_mode}. About {script.estimated_seconds}s spoken. {script.status}. Structure: {script.structure_json}</p>
            <p>{script.spoken || script.voiceover}</p>
            {script.on_screen ? <p className="quiet">On screen: {script.on_screen}</p> : null}
            {script.quality_notes ? <p className="quiet">{script.quality_notes}</p> : null}
            <form action={saveScriptEdit}>
              <input type="hidden" name="contentId" value={id} />
              <textarea name="spoken" defaultValue={script.spoken ?? ""} rows={8} />
              <button type="submit">Edit script</button>
            </form>
            {script.status !== "locked" ? (
              <form action={lockContentScript}>
                <input type="hidden" name="contentId" value={id} />
                <button type="submit">Lock script</button>
              </form>
            ) : (
              <p className="quiet">Script locked. {style ? `Style: ${style.name}.` : "Choose a visual style next. No storyboard until you do."}</p>
            )}
          </>
        ) : (
          <p className="quiet">No script yet.</p>
        )}
      </section>
      <section>
        <h2>Style</h2>
        <p>{style?.name ?? "Not selected."}</p>
      </section>
      <section>
        <h2>Production</h2>
        {pack ? <p><Link href={`/production/${pack.id}`}>Open the production pack</Link></p> : <p className="quiet">No production pack. It is created only after the storyboard is approved.</p>}
        {item.stage === "STORYBOARD_REVIEW" ? (
          <form action={requestStoryboardPass}>
            <input type="hidden" name="contentId" value={id} />
            <button name="kind" value="SAME SCRIPT + SAME STYLE" type="submit">New pass, same script and style</button>
          </form>
        ) : null}
      </section>
    </article>
  );
}
