import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { lockContentVisuals, requestStoryboardPass } from "@/lib/actions";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Storyboard sheet" };

export default async function StoryboardSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const item = db.prepare(`SELECT id, title, brand, concept_id, stage FROM content_items WHERE id = ?`).get(id) as
    | { id: string; title: string | null; brand: string | null; concept_id: string | null; stage: string }
    | undefined;
  if (!item) notFound();
  const passes = db.prepare(`SELECT id, pass_number, kind, status FROM storyboard_passes WHERE content_id = ? ORDER BY pass_number`).all(id) as Array<{ id: string; pass_number: number; kind: string; status: string }>;
  const beats = db.prepare(`SELECT beats_json FROM content_scripts WHERE content_id = ? ORDER BY version DESC LIMIT 1`).get(id) as { beats_json: string | null } | undefined;
  const frames = item.concept_id
    ? (db.prepare(`SELECT id, generation_status, metadata FROM generated_assets WHERE concept_id = ? AND asset_role = 'STORYBOARD_FRAME' AND file_size > 0 ORDER BY created_at`).all(item.concept_id) as Array<{ id: string; generation_status: string; metadata: string | null }>)
    : [];
  let parsed: Array<{ name?: string; line?: string }> = [];
  try {
    parsed = beats?.beats_json ? (JSON.parse(beats.beats_json) as Array<{ name?: string; line?: string }>) : [];
  } catch {
    parsed = [];
  }

  return (
    <article>
      <header className="page-header">
        <p className="kicker">{item.brand}</p>
        <h1>Storyboard sheet</h1>
        <p className="lede">{item.title}. The whole film in one glance. Stage: {item.stage.replaceAll("_", " ")}.</p>
        <p className="row-actions">
          <Link href={`/production/content/${id}`}>Back</Link>
        </p>
      </header>
      {passes.length ? <p className="quiet">{passes.map((pass) => `Pass ${pass.pass_number}: ${pass.kind}`).join(" · ")}</p> : <p className="quiet">No storyboard pass yet. A style has to be chosen first.</p>}
      <div className="stack">
        {(frames.length ? frames.map((frame, index) => ({ key: frame.id, image: frame.id, status: frame.generation_status, line: parsed[index]?.line || parsed[index]?.name || `Beat ${index + 1}` })) : parsed.map((beat, index) => ({ key: String(index), image: "", status: "Not generated", line: beat.line || beat.name || `Beat ${index + 1}` }))).map((panel, index) => (
          <section className="card" key={panel.key}>
            <p className="kicker">Beat {index + 1} · {panel.status}</p>
            {panel.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/assets/${panel.image}`} alt="" />
            ) : (
              <p className="quiet">No frame</p>
            )}
            <p>{panel.line}</p>
          </section>
        ))}
      </div>
      <form action={requestStoryboardPass} className="row-actions">
        <input type="hidden" name="contentId" value={id} />
        <button name="kind" value="SAME SCRIPT + SAME STYLE" type="submit">New pass, same script and style</button>
        <button name="kind" value="CHANGE STYLE" type="submit">New pass, change style</button>
      </form>
      <form action={lockContentVisuals}>
        <input type="hidden" name="contentId" value={id} />
        <button type="submit">Approve visuals</button>
      </form>
    </article>
  );
}
