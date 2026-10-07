import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { promoteVisualAnchor, reviewVisualFrame } from "@/lib/actions";
import { listPackAssets, parseAssetMeta } from "@/lib/executor/assets";
import { getPack, listScenes } from "@/lib/factory/store";
import { getDb } from "@/lib/db/client";
import { storyboardEstimate } from "@/lib/visual/generate";
import { getIntent } from "@/lib/visual/intent";

export const metadata: Metadata = { title: "Storyboard" };

export default async function StoryboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const pack = getPack(db, id);
  if (!pack) notFound();
  const scenes = listScenes(db, id);
  const assets = listPackAssets(db, id);
  const lock = pack.creative_concept_id ? getIntent(db, pack.creative_concept_id) : undefined;
  const estimate = pack.creative_concept_id ? storyboardEstimate(db, pack.creative_concept_id) : null;
  const shots = pack.creative_concept_id
    ? (db.prepare(`SELECT scene_number, role, story_purpose, visual_joke, composition FROM shot_plans WHERE concept_id = ?`).all(pack.creative_concept_id) as Array<{
        scene_number: number;
        role: string | null;
        story_purpose: string | null;
        visual_joke: string | null;
        composition: string | null;
      }>)
    : [];

  return (
    <article className="story-flow">
      <header className="page-header">
        <p className="kicker">{lock?.brand || pack.brand || "UNKNOWN BRAND"}</p>
        <h1>Storyboard</h1>
        <p className="lede">
          {lock ? `${lock.visual_medium}. ${lock.required_motif}` : "No creative intent lock yet."} A file is not a pass. Frames say whether visual QA passed.
        </p>
        {estimate ? (
          <p className="quiet">
            {estimate.frames} frames, {estimate.heroes} hero. First pass {estimate.firstPass}. Maximum {estimate.maximumGenerations}. Estimated maximum{" "}
            {estimate.estimateUsd == null ? "unknown" : `$${estimate.estimateUsd.toFixed(2)}`}.
          </p>
        ) : null}
        <p className="row-actions">
          <Link href={`/production/${id}`}>Back to the pack</Link>
        </p>
      </header>
      {scenes.map((scene, index) => {
        const frame =
          assets
            .filter((asset) => asset.scene_id === scene.id && asset.asset_role === "STORYBOARD_FRAME" && asset.file_size)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
        const shot = shots.find((item) => item.scene_number === scene.scene_number);
        const meta = frame ? parseAssetMeta(frame.metadata) : {};
        const critique = frame
          ? (db.prepare(`SELECT summary, scores, regeneration_plan FROM visual_critiques WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1`).get(frame.id) as
              | { summary: string | null; scores: string; regeneration_plan: string | null }
              | undefined)
          : undefined;
        const references = frame
          ? (db.prepare(`SELECT reference_asset_id, purpose, sent FROM generation_references WHERE asset_id = ?`).all(frame.id) as Array<{
              reference_asset_id: string;
              purpose: string;
              sent: number;
            }>)
          : [];
        const unresolved = meta.qa === "unresolved" || frame?.generation_status === "AI_QA_FAILED";
        return (
          <section className="story-beat" key={scene.id}>
            <p className="kicker">
              Scene {scene.scene_number}
              {shot?.role ? ` · ${shot.role}` : ""}
              {frame ? ` · ${frame.generation_status}` : ""}
            </p>
            {unresolved ? <p className="asset-error">NEEDS HAYDEN — AI QA COULD NOT RESOLVE. {frame?.error_message}</p> : null}
            {frame ? (
              <Link href={`/api/assets/${frame.id}`} target="_blank">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/assets/${frame.id}`} alt={`Scene ${scene.scene_number}`} />
              </Link>
            ) : (
              <p className="asset-empty">Not generated</p>
            )}
            <p className="story-line">{shot?.story_purpose || scene.action || scene.visual || "No visual intent stored."}</p>
            {shot?.visual_joke ? <p className="quiet">Visual joke: {shot.visual_joke}</p> : null}
            {critique ? <p className="quiet">Critic: {critique.summary}</p> : null}
            {references.length ? (
              <p className="quiet">References: {references.map((item) => `${item.purpose} ${item.sent ? "sent" : "not sent"}`).join(", ")}</p>
            ) : null}
            {frame ? (
              <p className="quiet">
                Attempt {meta.attempt ?? 1}
                {meta.qualityMode ? ` · ${meta.qualityMode}` : ""}
                {meta.apiQuality ? ` · ${meta.apiQuality}` : ""}
                {meta.resolution ? ` · ${meta.resolution}` : ""}
                {meta.costUsd != null ? ` · about $${Number(meta.costUsd).toFixed(2)} list` : ""}
              </p>
            ) : null}
            {frame ? (
              <>
                <form action={reviewVisualFrame} className="row-actions">
                  <input type="hidden" name="assetId" value={frame.id} />
                  <input type="hidden" name="next" value={`/production/${id}/storyboard`} />
                  <input name="note" placeholder="Too corporate." />
                  <button className="text-button" name="status" value="approved" type="submit">Approve</button>
                  <button className="text-button" name="status" value="rejected" type="submit">Reject</button>
                  <button className="text-button" name="status" value="regenerate" type="submit">Regenerate with note</button>
                </form>
                <form action={promoteVisualAnchor} className="row-actions">
                  <input type="hidden" name="assetId" value={frame.id} />
                  <input type="hidden" name="next" value={`/production/${id}/storyboard`} />
                  <button className="text-button" name="kind" value="style" type="submit">Make style reference</button>
                  <button className="text-button" name="kind" value="character" type="submit">Make character reference</button>
                  <button className="text-button" name="kind" value="environment" type="submit">Make environment reference</button>
                </form>
                <details>
                  <summary>View prompt</summary>
                  <p className="quiet">{frame.prompt}</p>
                </details>
                {critique ? (
                  <details>
                    <summary>View critique</summary>
                    <p className="quiet">{critique.scores}</p>
                    <p className="quiet">{critique.regeneration_plan}</p>
                  </details>
                ) : null}
              </>
            ) : null}
            {index < scenes.length - 1 ? <p className="story-arrow" aria-hidden="true">↓</p> : null}
          </section>
        );
      })}
    </article>
  );
}
