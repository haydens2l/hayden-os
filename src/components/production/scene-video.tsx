import { generateSceneVideoAction, regenerateSceneVideoAction, reviewProductionAsset } from "@/lib/actions";
import type { AssetRow } from "@/lib/executor/assets";
import type { SceneVideoReadiness } from "@/lib/executor/video/run";
import { OMNI_COST_NOTE } from "@/lib/executor/video/record";

export function SceneVideo({
  packId,
  sceneId,
  sceneNumber,
  assets,
  readiness,
}: {
  packId: string;
  sceneId: string;
  sceneNumber: number;
  assets: AssetRow[];
  readiness: SceneVideoReadiness;
}) {
  const versions = assets
    .filter((asset) => asset.scene_id === sceneId && asset.asset_role === "SCENE_VIDEO")
    .sort((a, b) => b.version - a.version);
  const current = versions[0];
  const playable = current?.file_size && current.storage_location ? current : null;
  const start = current ? assets.find((asset) => asset.id === current.start_frame_asset_id) : undefined;
  const end = current ? assets.find((asset) => asset.id === current.end_frame_asset_id) : undefined;
  const canGenerate = readiness.state === "ready" || readiness.state === "failed" || readiness.state === "rejected";

  return (
    <div className="scene-player">
      <h4>Scene video</h4>
      <p>{readiness.reason}</p>
      {playable ? (
        <video controls preload="metadata" src={`/api/assets/${playable.id}`}>
          <a href={`/api/assets/${playable.id}`}>Open the clip</a>
        </video>
      ) : (
        <p>{current ? `Status: ${current.generation_status}.` : "Not generated."}</p>
      )}
      {current?.error_message ? <p>{current.error_message}</p> : null}
      <div className="scene-assets">
        <FrameStill label="Start frame" asset={start} />
        <FrameStill label="End frame" asset={end} />
      </div>
      {current ? (
        <>
          <p>
            Duration requested: {current.duration_requested ?? "unset"}s
            {current.duration_actual != null ? ` · File length: ${current.duration_actual}s` : ""}
          </p>
          <p>
            Status: {current.generation_status} · Provider: {current.provider || "unset"} · {current.model || "unset"} · Version {current.version}
          </p>
          <p>{current.cost_note || OMNI_COST_NOTE}</p>
          <p>The frames above are the exact versions sent. A newer frame does not change this clip.</p>
          <details>
            <summary>View prompt</summary>
            <pre className="prompt-block">{current.prompt}</pre>
          </details>
          {playable ? (
            <p>
              <a href={`/api/assets/${playable.id}`} download>
                Download
              </a>
            </p>
          ) : null}
          {playable ? (
            <form action={reviewProductionAsset} className="decision-actions">
              <input type="hidden" name="assetId" value={playable.id} />
              <input type="hidden" name="next" value={`/production/${packId}`} />
              <button className="decision-button decision-approve" name="decision" value="APPROVED" type="submit">
                Approve
              </button>
              <button className="decision-button decision-reject" name="decision" value="REJECTED" type="submit">
                Reject
              </button>
            </form>
          ) : null}
          <form action={regenerateSceneVideoAction} className="stack">
            <input type="hidden" name="packId" value={packId} />
            <input type="hidden" name="sceneId" value={sceneId} />
            <input type="hidden" name="next" value={`/production/${packId}`} />
            <label htmlFor={`video-feedback-${sceneNumber}`}>
              Feedback
              <textarea id={`video-feedback-${sceneNumber}`} name="feedback" rows={3} placeholder="Character changes halfway through." />
            </label>
            <button className="decision-button decision-changes" type="submit">
              Regenerate video
            </button>
          </form>
        </>
      ) : null}
      {canGenerate ? (
        <form action={generateSceneVideoAction} className="decision-actions">
          <input type="hidden" name="packId" value={packId} />
          <input type="hidden" name="sceneId" value={sceneId} />
          <input type="hidden" name="next" value={`/production/${packId}`} />
          <p>{OMNI_COST_NOTE}</p>
          <button className="decision-button decision-approve" type="submit">
            {readiness.state === "failed" ? "Retry video" : "Generate video"}
          </button>
        </form>
      ) : null}
      {versions.length > 1 ? (
        <ul>
          {versions.slice(1).map((version) => (
            <li key={version.id}>
              Version {version.version}: {version.generation_status}
              {version.file_size ? <a href={`/api/assets/${version.id}`}> Open</a> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FrameStill({ label, asset }: { label: string; asset: AssetRow | undefined }) {
  return (
    <article className="asset-card">
      <h4>{label}</h4>
      {asset?.file_size ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/assets/${asset.id}`} alt={`${label}, version ${asset.version}`} />
      ) : (
        <p>Not linked yet.</p>
      )}
    </article>
  );
}
