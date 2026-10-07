import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  assignProduction,
  generatePackVideosAction,
  generateProductionFrames,
  generateVisualStoryboard,
  returnPackToCreative,
  reviewPack,
  reviseProductionPack,
  saveProductionChecklist,
  saveProductionFeedback,
  sendPackInsight,
} from "@/lib/actions";
import { SceneAssets } from "@/components/production/scene-assets";
import { SceneVideo } from "@/components/production/scene-video";
import { HowLink } from "@/components/shell/how-link";
import { listPackAssets } from "@/lib/executor/assets";
import { videoConfig } from "@/lib/executor/providers";
import { packVideoLabel, resumeVideoJobsOnce, sceneVideoReadiness, videoCostSummary } from "@/lib/executor/video/run";
import { executionView, getPack, listScenes, packVersions } from "@/lib/factory/store";
import { FEEDBACK_KINDS, FRAME_TYPES, productionTypeLabel, statusLabel, type ProductionType } from "@/lib/factory/types";
import { listModelProfiles } from "@/lib/factory/models";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Production pack" };
export const maxDuration = 300;

export default async function ProductionPackPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;
  const db = getDb();
  await resumeVideoJobsOnce(db);
  const pack = getPack(db, id);
  if (!pack) notFound();
  const scenes = listScenes(db, id);
  const versions = packVersions(db, pack.root_id);
  const execution = executionView(db, id);
  const profiles = listModelProfiles(db);
  const continuity = JSON.parse(pack.continuity_report || "[]") as Array<{ scene: number; problem: string; recommendedFix: string }>;
  const durations = JSON.parse(pack.duration_report || "[]") as Array<{ scene: number; ok: boolean; message: string }>;
  const characters = parseList(pack.character_bible);
  const focused = view === "lily" || view === "danny";
  const assets = listPackAssets(db, id);
  const imageFiles = assets.filter((asset) => asset.asset_role !== "SCENE_VIDEO" && asset.file_size && asset.file_size > 0).length;
  const framesApply = FRAME_TYPES.has(pack.production_type as ProductionType);
  const videoReadiness = framesApply ? sceneVideoReadiness(db, id) : [];
  const readyVideoScenes = videoReadiness.filter((item) => item.state === "ready" || item.state === "failed").length;
  const videoConfigured = videoConfig().configured;

  return (
    <>
      <header className="page-header">
        <p className="kicker">{view === "danny" ? "Creative direction and production" : view === "lily" ? "Execution" : "Production pack"}</p>
        <h1>{execution?.what}</h1>
        <p className="lede">
          {productionTypeLabel(pack.production_type)} · {statusLabel(pack.status)} · version {pack.version}.{" "}
          {imageFiles > 0 ? `${imageFiles} image file${imageFiles === 1 ? "" : "s"} stored. ` : "No image file has been generated. "}
          {framesApply ? packVideoLabel(scenes, assets) : "This format does not use scene video."}
        </p>
        {view === "danny" ? (
          <p>Danny can direct and produce from this pack. This does not make Danny the Creative Director. That role change is still a hypothesis.</p>
        ) : null}
        {pack.unapproved_override ? <p>This concept has not been approved. Hayden sent it anyway.</p> : null}
      </header>
      <p className="row-actions">
        <Link href={`/production/${id}?view=lily`}>Lily view</Link>
        <Link href={`/production/${id}?view=danny`}>Danny view</Link>
        <Link href={`/production/${id}`}>Full pack</Link>
        <Link href={`/production/${id}/storyboard`}>Storyboard</Link>
        <Link href="/production">Production board</Link>
      </p>
      <HowLink href="/help#storyboard" />
      {focused && execution ? (
        <section className="section">
          <h2>What we are making</h2>
          <p>{execution.what}</p>
          <h2>Reference</h2>
          <p>{execution.reference || "No reference stored."}</p>
          <h2>Final script</h2>
          <pre className="prompt-block">{execution.script}</pre>
          <h2>Global style</h2>
          <p>{execution.style || "No global style stored."}</p>
          <p>{execution.voice}</p>
          {execution.scenes.map((scene) => (
            <article className="record" key={scene.number}>
              <h3>Scene {scene.number}</h3>
              <p>
                <span className="label">Start frame </span>
                {scene.startFrame || "Not set"}
              </p>
              <p>
                <span className="label">End frame </span>
                {scene.endFrame || "Not set"}
              </p>
              <p>
                <span className="label">Prompt </span>
              </p>
              <pre className="prompt-block">{scene.prompt}</pre>
              <p>
                <span className="label">VO </span>
                {scene.voiceover || "None"}
              </p>
              <p>
                <span className="label">SFX </span>
                {scene.sfx || "None"}
              </p>
              <p>
                <span className="label">Notes </span>
                {scene.notes || "None"}
              </p>
            </article>
          ))}
          <h2>Checklist</h2>
          <form action={saveProductionChecklist} className="stack">
            <input type="hidden" name="packId" value={pack.id} />
            <input type="hidden" name="next" value={`/production/${pack.id}?view=${view}`} />
            <label>
              <input type="checkbox" name="assetsCreated" value="yes" defaultChecked={execution.checklist.assetsCreated} /> Assets created
            </label>
            <label>
              <input type="checkbox" name="scenesGenerated" value="yes" defaultChecked={execution.checklist.scenesGenerated} /> Scenes generated
            </label>
            <label>
              <input type="checkbox" name="voComplete" value="yes" defaultChecked={execution.checklist.voComplete} /> VO complete
            </label>
            <label>
              <input type="checkbox" name="editComplete" value="yes" defaultChecked={execution.checklist.editComplete} /> Edit complete
            </label>
            <label>
              <input type="checkbox" name="readyForReview" value="yes" defaultChecked={execution.checklist.readyForReview} /> Ready for review
            </label>
            <button className="text-button" type="submit">
              Save checklist
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="section">
            <h2>Continuity {pack.continuity_status === "pass" ? "pass" : "issues found"}</h2>
            {continuity.length === 0 ? <p>No continuity break stored.</p> : null}
            {continuity.map((issue) => (
              <article className="record" key={`${issue.scene}-${issue.problem}`}>
                <h3>Scene {issue.scene}</h3>
                <p>{issue.problem}</p>
                <p>{issue.recommendedFix}</p>
              </article>
            ))}
            <h2>Duration</h2>
            {durations.map((item) => (
              <p key={item.scene}>
                Scene {item.scene}: {item.message}
              </p>
            ))}
            <h2>Master script</h2>
            <pre className="prompt-block">{pack.script}</pre>
            <h2>Character bible</h2>
            {characters.length === 0 ? <p>No recurring character stored.</p> : null}
            {characters.map((character) => (
              <article className="record" key={character.name}>
                <h3>{character.name || "Unnamed"}</h3>
                <p>
                  {character.appearance} {character.hair} {character.clothing} {character.accessories}
                </p>
                <p>
                  {character.personality} Voice: {character.voice} {character.accent} {character.bodyLanguage}
                </p>
                <p>{character.referenceNotes}</p>
              </article>
            ))}
          </section>
          <section className="section">
            <h2>Assign production</h2>
            <form action={assignProduction} className="row-actions">
              <input type="hidden" name="packId" value={pack.id} />
              <input type="hidden" name="next" value={`/production/${pack.id}`} />
              <select name="owner" className="delegate-select" defaultValue={pack.production_owner ?? "lily"}>
                <option value="lily">Lily</option>
                <option value="danny">Danny</option>
              </select>
              <input name="dueDate" type="date" defaultValue={pack.due_date ?? ""} />
              <button className="text-button" type="submit">
                Assign production
              </button>
            </form>
            <form action={reviewPack} className="row-actions">
              <input type="hidden" name="packId" value={pack.id} />
              <input type="hidden" name="next" value={`/production/${pack.id}`} />
              <button className="text-button" name="status" value="approved" type="submit">
                Approve pack
              </button>
              <button className="text-button" name="status" value="in_production" type="submit">
                In production
              </button>
              <button className="text-button" name="status" value="blocked" type="submit">
                Blocked
              </button>
              <button className="text-button" name="status" value="complete" type="submit">
                Confirm complete
              </button>
            </form>
          </section>
          <section className="section">
            <h2>Pictures</h2>
            <p>A picture appears here only after a file is stored. Generating spends image credits. Nothing is generated until you click.</p>
            <form action={generateVisualStoryboard} className="decision-actions">
              <input type="hidden" name="packId" value={pack.id} />
              <input type="hidden" name="next" value={`/production/${pack.id}/storyboard`} />
              <button className="decision-button decision-approve" type="submit">
                Generate visual storyboard
              </button>
            </form>
            {framesApply ? (
              <form action={generateProductionFrames} className="decision-actions">
                <input type="hidden" name="packId" value={pack.id} />
                <input type="hidden" name="next" value={`/production/${pack.id}`} />
                <button className="decision-button decision-changes" type="submit">
                  Generate frames
                </button>
              </form>
            ) : (
              <p>Start and end frames are for AI video packs. This format does not use them.</p>
            )}
            {framesApply ? (
              <>
                <h2>Scene videos</h2>
                <p>A scene clip is one shot. It is not the finished video. Nothing here is generated until you click.</p>
                {videoConfigured ? null : <p>The Gemini API key is not set, so Generate video will not submit a job.</p>}
                <ul>
                  {videoReadiness.map((item) => (
                    <li key={item.sceneId}>{item.reason}</li>
                  ))}
                </ul>
                <p>{videoCostSummary(readyVideoScenes)}</p>
                <form action={generatePackVideosAction} className="decision-actions">
                  <input type="hidden" name="packId" value={pack.id} />
                  <input type="hidden" name="next" value={`/production/${pack.id}`} />
                  <button className="decision-button decision-approve" type="submit">
                    Generate video scenes
                  </button>
                </form>
              </>
            ) : null}
            <h2>Scenes</h2>
            {scenes.map((scene) => (
              <article className="record" key={scene.id}>
                <h3>
                  Scene {scene.scene_number}
                  {scene.duration_seconds ? ` · ${scene.duration_seconds}s` : ""}
                </h3>
                <p>{scene.objective}</p>
                <p>Start: {scene.start_frame}</p>
                <p>End: {scene.end_frame}</p>
                <pre className="prompt-block">{scene.video_prompt}</pre>
                <p>VO: {scene.voiceover || "None"}</p>
                <p>SFX: {scene.sfx || "None"} · Music: {scene.music_notes || "None"}</p>
                <p>
                  From previous: {scene.continuity_from || "None"}. Into next: {scene.continuity_into || "None"}.
                </p>
                <SceneAssets packId={pack.id} sceneId={scene.id} sceneNumber={scene.scene_number} assets={assets} showFrames={framesApply} />
                {framesApply ? (
                  <SceneVideo
                    packId={pack.id}
                    sceneId={scene.id}
                    sceneNumber={scene.scene_number}
                    assets={assets}
                    readiness={videoReadiness.find((item) => item.sceneId === scene.id) ?? { sceneId: scene.id, sceneNumber: scene.scene_number, state: "blocked", reason: `Scene ${scene.scene_number} — missing video prompt` }}
                  />
                ) : null}
              </article>
            ))}
          </section>
          <section className="section">
            <h2>Feedback</h2>
            <form action={saveProductionFeedback} className="stack">
              <input type="hidden" name="packId" value={pack.id} />
              <input type="hidden" name="next" value={`/production/${pack.id}`} />
              <select name="sceneId" className="delegate-select" defaultValue={scenes[0]?.id ?? ""}>
                {scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    Scene {scene.scene_number}
                  </option>
                ))}
              </select>
              <select name="modelProfileId" className="delegate-select" defaultValue={pack.model_profile_id ?? ""}>
                <option value="">Model unknown</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <select name="kind" className="delegate-select" defaultValue="prompt_failed">
                {FEEDBACK_KINDS.map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
              <textarea name="note" rows={3} placeholder="What failed in production." />
              <button className="text-button" type="submit">
                Store feedback
              </button>
            </form>
          </section>
          <section className="section">
            <h2>Version {pack.version}</h2>
            <p>
              {versions.map((version) => (
                <Link key={version.id} href={`/production/${version.id}`}>
                  V{version.version}{" "}
                </Link>
              ))}
            </p>
            <form action={reviseProductionPack} className="stack">
              <input type="hidden" name="packId" value={pack.id} />
              <textarea name="note" rows={2} placeholder="Scene 3 doesn't work." />
              <button className="text-button" type="submit">
                Create next version
              </button>
            </form>
            <form action={returnPackToCreative} className="row-actions">
              <input type="hidden" name="packId" value={pack.id} />
              <input type="hidden" name="next" value={`/production/${pack.id}`} />
              <select name="reason" className="delegate-select" defaultValue="concept issue">
                <option>concept issue</option>
                <option>hook issue</option>
                <option>script issue</option>
                <option>format issue</option>
                <option>production infeasibility</option>
              </select>
              <button className="text-button" type="submit">
                Return to Creative
              </button>
            </form>
            <form action={sendPackInsight} className="stack">
              <input type="hidden" name="packId" value={pack.id} />
              <input type="hidden" name="next" value={`/production/${pack.id}`} />
              <textarea name="insight" rows={2} placeholder="This format could repeat." />
              <button className="text-button" type="submit">
                Send insight to Media Director
              </button>
            </form>
          </section>
        </>
      )}
    </>
  );
}

function parseList(value: string | null) {
  try {
    const parsed = JSON.parse(value || "[]") as Array<Record<string, string>>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
