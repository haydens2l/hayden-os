import Link from "next/link";
import { regenerateProductionAsset, reviewProductionAsset } from "@/lib/actions";
import { displayAsset, parseAssetMeta, type AssetRow } from "@/lib/executor/assets";
import type { AssetRole } from "@/lib/executor/types";

const ROLES: Array<[AssetRole, string]> = [
  ["STORYBOARD_FRAME", "Storyboard"],
  ["START_FRAME", "Start frame"],
  ["END_FRAME", "End frame"],
];

export function SceneAssets({
  packId,
  sceneId,
  sceneNumber,
  assets,
  showFrames,
}: {
  packId: string;
  sceneId: string;
  sceneNumber: number;
  assets: AssetRow[];
  showFrames: boolean;
}) {
  const roles = showFrames ? ROLES : ROLES.filter(([role]) => role === "STORYBOARD_FRAME");
  return (
    <div className="scene-assets">
      {roles.map(([role, label]) => {
        const versions = assets.filter((asset) => asset.scene_id === sceneId && asset.asset_role === role).sort((a, b) => b.version - a.version);
        const shown = displayAsset(versions);
        const latest = versions[0];
        const failed = latest?.generation_status === "FAILED" ? latest : null;
        return (
          <article className="asset-card" key={role}>
            <h4>{label}</h4>
            {shown?.id ? (
              <Link href={`/api/assets/${shown.id}`} target="_blank">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/assets/${shown.id}`} alt={`${label} for scene ${sceneNumber}`} />
              </Link>
            ) : (
              <p className="asset-empty">Not generated</p>
            )}
            <p className="asset-status">{shown ? statusLabel(shown.generation_status) : failed ? "Failed" : "No file"}</p>
            {failed?.error_message ? <p className="asset-error">{failed.error_message}</p> : null}
            {shown?.prompt ? (
              <details>
                <summary>View prompt</summary>
                <pre className="prompt-block">{shown.prompt}</pre>
              </details>
            ) : null}
            {shown ? (
              <>
                <form action={reviewProductionAsset} className="decision-actions">
                  <input type="hidden" name="assetId" value={shown.id} />
                  <input type="hidden" name="next" value={`/production/${packId}`} />
                  <button className="decision-button decision-approve" name="decision" value="APPROVED" type="submit">
                    Approve
                  </button>
                  <button className="decision-button decision-reject" name="decision" value="REJECTED" type="submit">
                    Reject
                  </button>
                </form>
                <form action={regenerateProductionAsset} className="stack">
                  <input type="hidden" name="assetId" value={shown.id} />
                  <input type="hidden" name="next" value={`/production/${packId}`} />
                  <textarea name="feedback" rows={2} placeholder="Dave looks too polished." />
                  <button className="decision-button decision-changes" type="submit">
                    Regenerate
                  </button>
                </form>
                <p className="asset-note">{versionNote(shown, parseAssetMeta(shown.metadata).feedback)}</p>
              </>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function statusLabel(status: string) {
  if (status === "NEEDS_REVIEW") return "Needs your review";
  if (status === "APPROVED") return "Approved by you";
  if (status === "REJECTED") return "Rejected";
  return status.replaceAll("_", " ").toLowerCase();
}

function versionNote(asset: AssetRow, feedback?: string) {
  const version = asset.version > 1 ? `Version ${asset.version}. The earlier file is still stored.` : "First version.";
  return feedback ? `${version} Last note: ${feedback}` : version;
}
