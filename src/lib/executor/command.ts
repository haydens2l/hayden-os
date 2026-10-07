import type Database from "better-sqlite3";
import type { CommandAnswer } from "@/lib/command/answer";
import { getPack, listScenes } from "@/lib/factory/store";
import { displayAsset, getAsset, latestForRole, listPackAssets } from "@/lib/executor/assets";
import { generateFrames, generateStoryboard, regenerateAsset } from "@/lib/executor/run";
import { explainSceneVideo, generateReadySceneVideos, generateSceneVideo, regenerateSceneVideo, videoCostSummary } from "@/lib/executor/video/run";
import { isProductionCommand } from "@/lib/team/route";

export { isProductionCommand };

export async function runProductionCommand(db: Database.Database, query: string): Promise<CommandAnswer> {
  const text = query.toLowerCase();
  const resolved = resolvePack(db, text);
  if (resolved.kind === "none") {
    return {
      heading: "Production",
      summary: "There is no production pack yet. Approve a concept, then turn it into a pack. Pictures and scene video are only made after that, and only when you ask.",
      items: [],
    };
  }
  if (resolved.kind === "ask") return { heading: "Production", summary: resolved.ask, items: resolved.items };
  const pack = resolved.pack;
  if (/which scenes are|what'?s missing before|why did scene|how much will it cost|show me the prompt used for scene/i.test(text)) {
    return answerVideoQuestion(db, pack.id, text);
  }
  if (/generate (the )?video|generate (all )?ready scenes|make the video scenes|generate (the )?scene \d+/i.test(text)) {
    const number = Number(text.match(/scene\s+(\d+)/)?.[1] ?? "");
    if (number) {
      const scene = listScenes(db, pack.id).find((item) => item.scene_number === number);
      if (!scene) return { heading: "Production", summary: `Scene ${number} is not in this pack.`, items: packLink(pack.id, pack.brand) };
      const report = await generateSceneVideo(db, pack.id, scene.id);
      return videoReportAnswer(db, pack.id, report, `Scene ${number} was sent only if it had an approved start frame, an approved end frame, a prompt, and a supported duration.`);
    }
    const report = await generateReadySceneVideos(db, pack.id);
    return videoReportAnswer(db, pack.id, report, "Ready scenes were sent. A scene that is missing something was left alone. The final video is not assembled.");
  }
  if (/regenerate scene\b/i.test(text) && /video|movement|halfway|voice|dialogue|camera|too fast|static|cut off|slow the/i.test(text)) {
    const number = Number(text.match(/scene\s+(\d+)/)?.[1] ?? "");
    const scene = listScenes(db, pack.id).find((item) => item.scene_number === number);
    if (!scene) return { heading: "Production", summary: `Scene ${number || "?"} is not in this pack.`, items: packLink(pack.id, pack.brand) };
    const feedback = query.replace(/regenerate scene\s+\d+\.?/i, "").trim();
    const report = await regenerateSceneVideo(db, scene.id, feedback);
    return videoReportAnswer(db, pack.id, report, "A new scene video was requested. The previous clip is still stored.");
  }
  if (/regenerate scene\b/i.test(text)) {
    const number = Number(text.match(/scene\s+(\d+)/)?.[1] ?? "");
    const scene = listScenes(db, pack.id).find((item) => item.scene_number === number);
    if (!scene) {
      return { heading: "Production", summary: `Pack found, but scene ${number || "?"} is not in it.`, items: [{ title: pack.brand || "Pack", detail: "Open the pack and check the scene numbers.", href: `/production/${pack.id}`, source: "production_packs", kind: "Pack" }] };
    }
    const role = /end frame/.test(text) ? "END_FRAME" : /start frame/.test(text) ? "START_FRAME" : "STORYBOARD_FRAME";
    const current = displayAsset(latestForRole(listPackAssets(db, pack.id), scene.id, role));
    if (!current) {
      return { heading: "Production", summary: `Scene ${scene.scene_number} has no ${role.replaceAll("_", " ").toLowerCase()} image to regenerate.`, items: [{ title: `Scene ${scene.scene_number}`, detail: "Generate it first.", href: `/production/${pack.id}`, source: "generated_assets", kind: "Image" }] };
    }
    const feedback = query.replace(/regenerate scene\s+\d+\.?/i, "").trim();
    const report = await regenerateAsset(db, current.id, feedback);
    return reportAnswer(pack.id, report, "A new version was requested. The previous image is still stored.");
  }
  if (/start and end|start \+ end|generate frames|generate the frames/i.test(text)) {
    const report = await generateFrames(db, pack.id);
    return reportAnswer(pack.id, report, "Start and end frames were requested for the AI-video scenes in the latest pack.");
  }
  const report = await generateStoryboard(db, pack.id);
  return reportAnswer(pack.id, report, "A visual storyboard was requested from the latest production pack.");
}

function resolvePack(db: Database.Database, text: string) {
  const rows = db
    .prepare(
      `SELECT id, brand, organisation_id FROM production_packs
       WHERE NOT EXISTS (SELECT 1 FROM production_packs newer WHERE newer.supersedes_id = production_packs.id)
       ORDER BY updated_at DESC`,
    )
    .all() as Array<{ id: string; brand: string | null; organisation_id: string | null }>;
  if (rows.length === 0) return { kind: "none" as const };
  const named = rows.filter((row) => brandMatch(text, row));
  const brandNamed = /property made simple|\bpms\b|\bfifo\b|inception|\bwlth\b/.test(text);
  if (brandNamed && named.length === 1) {
    const pack = getPack(db, named[0].id);
    return pack ? { kind: "pack" as const, pack } : { kind: "none" as const };
  }
  if (brandNamed && named.length !== 1) {
    return { kind: "ask" as const, ask: "More than one pack could match that. Open the pack you mean.", items: rows.map((row) => packItem(row.id, row.brand)) };
  }
  if (rows.length > 1) return { kind: "ask" as const, ask: "There is more than one production pack. Say the brand, or open the pack you mean.", items: rows.map((row) => packItem(row.id, row.brand)) };
  const pack = getPack(db, rows[0].id);
  return pack ? { kind: "pack" as const, pack } : { kind: "none" as const };
}

function brandMatch(text: string, row: { brand: string | null; organisation_id: string | null }) {
  if (/property made simple|\bpms\b/.test(text)) return row.organisation_id === "property-made-simple";
  if (/\bfifo\b/.test(text)) return row.organisation_id === "fifo" || /fifo/i.test(row.brand || "");
  if (/inception/.test(text)) return row.organisation_id === "inception" || /inception/i.test(row.brand || "");
  if (/\bwlth\b/.test(text)) return row.organisation_id === "wlth" || /wlth/i.test(row.brand || "");
  return false;
}

function answerVideoQuestion(db: Database.Database, packId: string, text: string): CommandAnswer {
  const items = explainSceneVideo(db, packId);
  if (/how much will it cost/.test(text)) {
    const ready = items.filter((item) => item.state === "ready" || item.state === "failed").length;
    return { heading: "Production", summary: videoCostSummary(ready), items: items.map((item) => readinessItem(packId, item)) };
  }
  if (/why did scene/.test(text)) {
    const number = Number(text.match(/scene\s+(\d+)/)?.[1] ?? "");
    const scene = listScenes(db, packId).find((item) => item.scene_number === number);
    const assets = scene ? listPackAssets(db, packId).filter((asset) => asset.scene_id === scene.id && asset.asset_role === "SCENE_VIDEO") : [];
    const latest = assets.sort((a, b) => b.version - a.version)[0];
    const summary = !scene
      ? `Scene ${number || "?"} is not in this pack.`
      : latest?.generation_status === "FAILED"
        ? `Scene ${scene.scene_number} failed. ${latest.error_message || "No error was stored."}`
        : latest
          ? `Scene ${scene.scene_number} is ${latest.generation_status}. ${latest.error_message || "There is no stored failure."}`
          : `Scene ${scene.scene_number} has no video attempt yet.`;
    return { heading: "Production", summary, items: [packItem(packId, `Scene ${number || ""}`)] };
  }
  if (/show me the prompt/.test(text)) {
    const number = Number(text.match(/scene\s+(\d+)/)?.[1] ?? "");
    const scene = listScenes(db, packId).find((item) => item.scene_number === number);
    const assets = scene ? listPackAssets(db, packId).filter((asset) => asset.scene_id === scene.id && asset.asset_role === "SCENE_VIDEO") : [];
    const latest = assets.sort((a, b) => b.version - a.version)[0];
    const prompt = latest?.prompt || scene?.video_prompt || "No video prompt is stored.";
    return { heading: "Production", summary: scene ? `Scene ${scene.scene_number} prompt:` : `Scene ${number || "?"} is not in this pack.`, items: [{ title: "Prompt", detail: prompt, href: `/production/${packId}`, source: "generated_assets", kind: "Prompt" }] };
  }
  const summary = /missing frames/.test(text)
    ? items.map((item) => item.reason).join(" ")
    : `Here is what each scene needs before a clip can be made. ${videoCostSummary(items.filter((item) => item.state === "ready").length)}`;
  return { heading: "Production", summary, items: items.map((item) => readinessItem(packId, item)) };
}

function readinessItem(packId: string, item: { sceneNumber: number; reason: string }) {
  return { title: `Scene ${item.sceneNumber}`, detail: item.reason, href: `/production/${packId}`, source: "generated_assets", kind: "Scene" };
}

function packLink(packId: string, brand: string | null) {
  return [packItem(packId, brand)];
}

function packItem(packId: string, brand: string | null) {
  return { title: brand || "Pack", detail: "Open this pack.", href: `/production/${packId}`, source: "production_packs", kind: "Pack" };
}

function videoReportAnswer(db: Database.Database, packId: string, report: { created: string[]; skipped: string[]; failed: Array<{ sceneNumber: number | null; message: string; assetId: string }> }, summary: string): CommandAnswer {
  const items = [
    ...report.created.map((id) => {
      const asset = getAsset(db, id);
      return { title: `Scene video ${id.slice(0, 8)}`, detail: asset?.generation_status === "NEEDS_REVIEW" ? "The clip is stored and waiting for you." : `Status: ${asset?.generation_status || "submitted"}. You can leave this page. The job stays on the scene.`, href: `/production/${packId}`, source: "generated_assets", kind: "Video" };
    }),
    ...report.failed.filter((failure) => failure.message).map((failure) => ({ title: failure.sceneNumber ? `Scene ${failure.sceneNumber}` : "Scene video", detail: failure.message, href: `/production/${packId}`, source: "generated_assets", kind: "Blocked" })),
  ];
  return { heading: "Production", summary, items };
}

function reportAnswer(packId: string, report: { created: string[]; skipped: string[]; failed: Array<{ sceneNumber: number | null; role: string; message: string }> }, summary: string): CommandAnswer {
  const items = [
    ...report.created.map((id) => ({
      title: `Image ${id.slice(0, 8)}`,
      detail: "A file is stored. It is waiting for you. It is not a finished video.",
      href: `/production/${packId}/storyboard`,
      source: "generated_assets",
      kind: "Image",
    })),
    ...report.skipped.map(() => ({ title: "Already generated", detail: "An image is already stored for that frame, so it was not generated again.", href: `/production/${packId}/storyboard`, source: "generated_assets", kind: "Image" })),
    ...report.failed.map((failure) => ({ title: failure.sceneNumber ? `Scene ${failure.sceneNumber}` : "Could not generate", detail: failure.message, href: `/production/${packId}`, source: "generated_assets", kind: "Failed" })),
  ];
  return { heading: "Production", summary, items };
}
