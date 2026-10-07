"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { brisbaneToday } from "@/lib/dates";
import { log } from "@/lib/log";
import { saveOpenQuestion, supersedeKnowledge, updateKnowledgeRecord, updateOrganisationStrategy, updatePersonContext } from "@/lib/brain/store";
import { FEEDBACK_VERDICTS, type FeedbackVerdict } from "@/lib/chief/types";
import { generateMorningBrief, saveBriefFeedback } from "@/lib/chief/persist";
import { disconnectDrive, approveSource, removeSource, syncApprovedFolders, readTokens, linkProjectSource } from "@/lib/integrations/google-drive/store";
import { googleDriveReader } from "@/lib/integrations/google-drive/google";
import { promoteDriveKnowledge } from "@/lib/integrations/google-drive/answer";
import { captureText, deferDecision, delegateWork, recordDecisionChoice, setTaskStatus as setStoredTaskStatus } from "@/lib/priority/store";
import { returnToCreative, sendInsightToMedia } from "@/lib/factory/loops";
import { setModelCapability } from "@/lib/factory/models";
import { supersedeRule } from "@/lib/factory/defaults";
import { assignPack, recordFeedback, revisePack, setPackStatus, updateChecklist } from "@/lib/factory/store";
import { CAPABILITY_FIELDS, FEEDBACK_KINDS, PACK_STATUSES, type CapabilityField, type PackStatus } from "@/lib/factory/types";
import { generateFrames, generateStoryboard, regenerateAsset, reviewAsset } from "@/lib/executor/run";
import { recordVisualFeedback, regenerateWithNote } from "@/lib/visual/generate";
import { lockIntent } from "@/lib/visual/intent";
import { knownBrand } from "@/lib/visual/brand";
import { generateReadySceneVideos, generateSceneVideo, regenerateSceneVideo } from "@/lib/executor/video/run";
import { assignAndRun, requestHandoff, setConceptStatus } from "@/lib/team/work";
import { approveConcept, approveVisuals, changeSpoken, createContentItem, developConcept, lockScript, newStoryboardPass, selectStyle, writeScript } from "@/lib/content/workflow";
import { styleById } from "@/lib/content/styles";

function finish(next: string) {
  revalidatePath("/", "layout");
  redirect(next);
}

function safeNext(value: FormDataEntryValue | null, fallback: string) {
  const next = String(value ?? fallback);
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}

export async function setTaskStatus(formData: FormData) {
  const next = safeNext(formData.get("next"), "/today");
  try {
    const status = String(formData.get("status") ?? "");
    if (status !== "done" && status !== "dismissed") throw new Error("That task update is not valid.");
    setStoredTaskStatus(getDb(), String(formData.get("id") ?? ""), status);
  } catch (error) {
    log.error("task update failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish(next);
}

export async function recordDecision(formData: FormData) {
  const next = safeNext(formData.get("next"), "/decisions");
  try {
    recordDecisionChoice(getDb(), String(formData.get("id") ?? ""), String(formData.get("choice") ?? "").trim());
  } catch (error) {
    log.error("decision record failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish(next);
}

export async function delegateItem(formData: FormData) {
  const next = safeNext(formData.get("next"), "/today");
  try {
    const entityType = String(formData.get("entity_type") ?? "");
    if (entityType !== "task" && entityType !== "decision") throw new Error("That item cannot be delegated.");
    const assignee = String(formData.get("assignee") ?? "");
    const [assigneeType, assigneeId] = assignee.split(":");
    if ((assigneeType !== "person" && assigneeType !== "agent") || !assigneeId) {
      throw new Error("Choose a person or an agent.");
    }
    delegateWork(getDb(), {
      entityType,
      entityId: String(formData.get("entity_id") ?? ""),
      assigneeType,
      assigneeId,
      deadline: String(formData.get("deadline") ?? ""),
      expectedOutcome: String(formData.get("expected_outcome") ?? ""),
    });
  } catch (error) {
    log.error("delegation failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish(next);
}

export async function deferItem(formData: FormData) {
  const next = safeNext(formData.get("next"), "/decisions");
  try {
    const deadline = String(formData.get("deadline") ?? "") || brisbaneToday(7);
    deferDecision(getDb(), String(formData.get("id") ?? ""), deadline);
  } catch (error) {
    log.error("defer failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish(next);
}

export async function saveOrganisationStrategy(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  try {
    const priority = Number(formData.get("strategic_priority"));
    updateOrganisationStrategy(getDb(), {
      id,
      strategicRole: String(formData.get("strategic_role") ?? ""),
      strategicPriority: priority,
      growthIntent: String(formData.get("growth_intent") ?? ""),
      haydenRole: String(formData.get("hayden_role") ?? ""),
      desiredHaydenInvolvement: String(formData.get("desired_hayden_involvement") ?? ""),
      businessModel: String(formData.get("business_model") ?? ""),
      primaryObjective: String(formData.get("primary_objective") ?? ""),
      timeHorizon: String(formData.get("time_horizon") ?? ""),
    });
  } catch (error) {
    log.error("strategy update failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish(`/intelligence/brain#${id}`);
}

export async function saveKnowledge(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  try {
    updateKnowledgeRecord(getDb(), {
      id,
      title: String(formData.get("title") ?? ""),
      content: String(formData.get("content") ?? ""),
      contextType: String(formData.get("context_type") ?? ""),
      confidence: String(formData.get("confidence") ?? ""),
    });
  } catch (error) {
    log.error("knowledge update failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish(`/intelligence/brain#${id}`);
}

export async function replaceKnowledge(formData: FormData) {
  try {
    supersedeKnowledge(getDb(), {
      oldId: String(formData.get("id") ?? ""),
      title: String(formData.get("title") ?? ""),
      content: String(formData.get("content") ?? ""),
    });
  } catch (error) {
    log.error("supersede failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish("/intelligence/brain");
}

export async function savePersonContext(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  try {
    updatePersonContext(getDb(), {
      id,
      role: String(formData.get("role") ?? ""),
      responsibilities: String(formData.get("responsibilities") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (error) {
    log.error("person update failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish(`/intelligence/brain#${id}`);
}

export async function saveQuestion(formData: FormData) {
  try {
    const org = String(formData.get("organisation_id") ?? "");
    saveOpenQuestion(getDb(), {
      id: String(formData.get("id") ?? "") || undefined,
      question: String(formData.get("question") ?? ""),
      why: String(formData.get("why") ?? ""),
      organisationId: org || null,
      status: String(formData.get("status") ?? "open"),
    });
  } catch (error) {
    log.error("question update failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish("/intelligence/brain");
}

export async function generateBrief() {
  try {
    await generateMorningBrief(getDb());
  } catch (error) {
    log.error("brief generation failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish("/today");
}

export async function saveBriefFeedbackAction(formData: FormData) {
  const briefId = String(formData.get("briefId") ?? "");
  const verdict = String(formData.get("verdict") ?? "");
  if (!FEEDBACK_VERDICTS.includes(verdict as FeedbackVerdict)) throw new Error("That feedback is not valid.");
  try {
    saveBriefFeedback(getDb(), {
      briefId,
      recommendationId: String(formData.get("recommendationId") ?? ""),
      verdict,
      comment: String(formData.get("comment") ?? ""),
    });
  } catch (error) {
    log.error("brief feedback failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish(briefId ? `/today?brief=${briefId}` : "/today");
}

export async function captureItem(formData: FormData) {
  let kind = "note";
  try {
    kind = captureText(getDb(), String(formData.get("text") ?? "")).kind;
  } catch (error) {
    log.error("capture failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  finish(`/?captured=${kind}`);
}

export async function syncDriveNow() {
  try {
    const db = getDb();
    const tokens = readTokens(db);
    if (!tokens) throw new Error("Google Drive is not connected.");
    await syncApprovedFolders(db, googleDriveReader(db, tokens.accessToken), "manual");
  } catch (error) {
    log.error("drive sync failed", { error: error instanceof Error ? error.message : "sync failed" });
    throw error;
  }
  finish("/settings/integrations/google-drive");
}

export async function disconnectDriveNow() {
  try {
    disconnectDrive(getDb());
  } catch (error) {
    log.error("drive disconnect failed", { error: error instanceof Error ? error.message : "disconnect failed" });
    throw error;
  }
  finish("/settings/integrations/google-drive");
}

export async function approveDriveFolder(formData: FormData) {
  try {
    approveSource(getDb(), {
      folderId: String(formData.get("folderId") ?? ""),
      name: String(formData.get("name") ?? "Folder"),
      path: String(formData.get("path") ?? "") || null,
    });
  } catch (error) {
    log.error("drive folder approval failed", { error: error instanceof Error ? error.message : "approval failed" });
    throw error;
  }
  finish("/settings/integrations/google-drive");
}

export async function removeDriveFolder(formData: FormData) {
  try {
    removeSource(getDb(), String(formData.get("folderId") ?? ""));
  } catch (error) {
    log.error("drive folder removal failed", { error: error instanceof Error ? error.message : "removal failed" });
    throw error;
  }
  finish("/settings/integrations/google-drive");
}

export async function promoteDriveToBrain(formData: FormData) {
  const fileId = String(formData.get("fileId") ?? "");
  try {
    promoteDriveKnowledge(getDb(), {
      fileId,
      title: String(formData.get("title") ?? ""),
      content: String(formData.get("content") ?? ""),
      contextType: String(formData.get("contextType") ?? ""),
      approved: String(formData.get("approved") ?? "") === "yes",
    });
  } catch (error) {
    log.error("drive promotion failed", { error: error instanceof Error ? error.message : "promotion failed" });
    throw error;
  }
  finish("/intelligence/brain");
}

export async function linkDriveToProject(formData: FormData) {
  try {
    linkProjectSource(getDb(), {
      projectId: String(formData.get("projectId") ?? ""),
      driveFileRowId: String(formData.get("fileId") ?? "") || null,
      folderId: String(formData.get("folderId") ?? "") || null,
      label: String(formData.get("label") ?? "Drive source"),
      webUrl: String(formData.get("webUrl") ?? "") || null,
    });
  } catch (error) {
    log.error("drive project link failed", { error: error instanceof Error ? error.message : "link failed" });
    throw error;
  }
  finish("/projects");
}

export async function assignToAgent(formData: FormData) {
  const next = safeNext(formData.get("next"), "/agents");
  try {
    const requestedBy = String(formData.get("requestedBy") ?? "hayden");
    await assignAndRun(getDb(), {
      agentId: String(formData.get("agentId") ?? ""),
      objective: String(formData.get("objective") ?? ""),
      requestedBy,
      requestedByLabel: requestedBy === "hayden" ? "Hayden" : requestedBy,
    });
  } catch (error) {
    log.error("agent assignment failed", { error: error instanceof Error ? error.message : "assignment failed" });
    throw error;
  }
  finish(next);
}

export async function reviewConcept(formData: FormData) {
  const next = safeNext(formData.get("next"), "/agents/creative");
  try {
    const status = String(formData.get("status") ?? "");
    if (status !== "idea" && status !== "shortlisted" && status !== "approved" && status !== "rejected" && status !== "archived" && status !== "changes_requested") {
      throw new Error("That concept status is not valid.");
    }
    setConceptStatus(getDb(), String(formData.get("id") ?? ""), status, String(formData.get("note") ?? ""));
  } catch (error) {
    log.error("concept review failed", { error: error instanceof Error ? error.message : "review failed" });
    throw error;
  }
  finish(next);
}

export async function sendToContentFactory(formData: FormData) {
  const conceptId = String(formData.get("conceptId") ?? "");
  const override = String(formData.get("override") ?? "") === "yes";
  let next = "/production";
  try {
    const concept = getDb().prepare(`SELECT id, title, status FROM creative_concepts WHERE id = ?`).get(conceptId) as
      | { id: string; title: string; status: string }
      | undefined;
    if (!concept) throw new Error("That concept is not in the library.");
    if (concept.status !== "approved" && !override) throw new Error("This concept has not been approved.");
    const job = await assignAndRun(getDb(), {
      agentId: "content",
      objective: `Produce a production pack for concept:${concept.id}${concept.status !== "approved" ? " override:unapproved" : ""}. ${concept.title}`,
      requestedBy: "hayden",
      requestedByLabel: "Hayden",
      title: `Production pack · ${concept.title}`,
    });
    const pack = getDb().prepare(`SELECT id FROM production_packs WHERE job_id = ?`).get(job.id) as { id: string } | undefined;
    next = pack
      ? `/production/${pack.id}`
      : `/agents/creative?notice=${encodeURIComponent(job.output_summary || "Content Factory did not store a pack.")}`;
  } catch (error) {
    log.error("content factory failed", { error: error instanceof Error ? error.message : "factory failed" });
    throw error;
  }
  finish(next);
}

export async function assignProduction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/production/${packId}`);
  try {
    const owner = String(formData.get("owner") ?? "");
    if (owner !== "lily" && owner !== "danny") throw new Error("Assign the pack to Lily or Danny.");
    assignPack(getDb(), packId, owner, String(formData.get("dueDate") ?? "") || null);
  } catch (error) {
    log.error("production assignment failed", { error: error instanceof Error ? error.message : "assignment failed" });
    throw error;
  }
  finish(next);
}

export async function reviewPack(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/production/${packId}`);
  try {
    const status = String(formData.get("status") ?? "");
    if (!PACK_STATUSES.includes(status as PackStatus)) throw new Error("That production status is not valid.");
    setPackStatus(getDb(), packId, status as PackStatus, status === "approved" ? "hayden" : null);
  } catch (error) {
    log.error("pack review failed", { error: error instanceof Error ? error.message : "review failed" });
    throw error;
  }
  finish(next);
}

export async function saveProductionChecklist(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/production/${packId}?view=lily`);
  try {
    updateChecklist(getDb(), packId, {
      assetsCreated: formData.get("assetsCreated") === "yes",
      scenesGenerated: formData.get("scenesGenerated") === "yes",
      voComplete: formData.get("voComplete") === "yes",
      editComplete: formData.get("editComplete") === "yes",
      readyForReview: formData.get("readyForReview") === "yes",
    });
  } catch (error) {
    log.error("checklist failed", { error: error instanceof Error ? error.message : "checklist failed" });
    throw error;
  }
  finish(next);
}

export async function saveProductionFeedback(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/production/${packId}`);
  try {
    const kind = String(formData.get("kind") ?? "");
    if (!FEEDBACK_KINDS.some(([id]) => id === kind)) throw new Error("That feedback type is not valid.");
    recordFeedback(getDb(), {
      packId,
      sceneId: String(formData.get("sceneId") ?? "") || null,
      modelProfileId: String(formData.get("modelProfileId") ?? "") || null,
      kind,
      note: String(formData.get("note") ?? ""),
      createdBy: String(formData.get("createdBy") ?? "lily"),
    });
  } catch (error) {
    log.error("production feedback failed", { error: error instanceof Error ? error.message : "feedback failed" });
    throw error;
  }
  finish(next);
}

export async function reviseProductionPack(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  let next = `/production/${packId}`;
  try {
    const saved = revisePack(getDb(), packId, String(formData.get("note") ?? "Scene note"), null);
    next = `/production/${saved.id}`;
  } catch (error) {
    log.error("pack revision failed", { error: error instanceof Error ? error.message : "revision failed" });
    throw error;
  }
  finish(next);
}

export async function returnPackToCreative(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/production/${packId}`);
  try {
    await returnToCreative(getDb(), packId, String(formData.get("reason") ?? ""));
  } catch (error) {
    log.error("return to creative failed", { error: error instanceof Error ? error.message : "return failed" });
    throw error;
  }
  finish(next);
}

export async function sendPackInsight(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/production/${packId}`);
  try {
    await sendInsightToMedia(getDb(), packId, String(formData.get("insight") ?? ""));
  } catch (error) {
    log.error("media insight failed", { error: error instanceof Error ? error.message : "insight failed" });
    throw error;
  }
  finish(next);
}

export async function replaceProductionRule(formData: FormData) {
  const next = safeNext(formData.get("next"), "/production");
  try {
    supersedeRule(getDb(), String(formData.get("ruleId") ?? ""), String(formData.get("body") ?? ""));
  } catch (error) {
    log.error("production rule failed", { error: error instanceof Error ? error.message : "rule failed" });
    throw error;
  }
  finish(next);
}

export async function recordModelCapability(formData: FormData) {
  const next = safeNext(formData.get("next"), "/production");
  try {
    const field = String(formData.get("field") ?? "");
    if (!CAPABILITY_FIELDS.includes(field as CapabilityField)) throw new Error("That model field is not configurable.");
    setModelCapability(getDb(), String(formData.get("profileId") ?? ""), field as CapabilityField, String(formData.get("value") ?? ""));
  } catch (error) {
    log.error("model capability failed", { error: error instanceof Error ? error.message : "capability failed" });
    throw error;
  }
  finish(next);
}

export async function startVisualDirection(formData: FormData) {
  const conceptId = String(formData.get("conceptId") ?? "");
  try {
    await assignAndRun(getDb(), {
      agentId: "visual",
      objective: `Create the visual direction. concept:${conceptId}`,
      requestedBy: "hayden",
      requestedByLabel: "Hayden",
    });
  } catch (error) {
    log.error("visual direction failed", { error: error instanceof Error ? error.message : "visual failed" });
    throw error;
  }
  finish(`/agents/visual`);
}

export async function assignConceptBrand(formData: FormData) {
  const conceptId = String(formData.get("conceptId") ?? "");
  const next = safeNext(formData.get("next"), `/agents/visual`);
  try {
    const named = knownBrand(String(formData.get("brand") ?? ""));
    if (!named) throw new Error("That brand is not a known organisation. Nothing was guessed.");
    getDb().prepare(`UPDATE creative_concepts SET organisation_id = ?, brand = ? WHERE id = ?`).run(named.id, named.name, conceptId);
    lockIntent(getDb(), conceptId);
  } catch (error) {
    log.error("brand assignment failed", { error: error instanceof Error ? error.message : "brand failed" });
    throw error;
  }
  finish(next);
}

export async function reviewVisualFrame(formData: FormData) {
  const assetId = String(formData.get("assetId") ?? "");
  const next = safeNext(formData.get("next"), "/production");
  try {
    const status = String(formData.get("status") ?? "");
    if (status === "approved") {
      getDb().prepare(`UPDATE generated_assets SET generation_status = 'APPROVED', approved_by = 'hayden', approved_at = ? WHERE id = ?`).run(new Date().toISOString(), assetId);
    } else if (status === "rejected") {
      const note = String(formData.get("note") ?? "").trim();
      getDb().prepare(`UPDATE generated_assets SET generation_status = 'REJECTED' WHERE id = ?`).run(assetId);
      if (note) recordVisualFeedback(getDb(), assetId, note);
    } else if (status === "regenerate") {
      const note = String(formData.get("note") ?? "").trim();
      if (!note) throw new Error("Add a short note before regenerating.");
      await regenerateWithNote(getDb(), assetId, note);
    } else {
      throw new Error("Approve or reject the frame.");
    }
  } catch (error) {
    log.error("visual review failed", { error: error instanceof Error ? error.message : "review failed" });
    throw error;
  }
  finish(next);
}

export async function promoteVisualAnchor(formData: FormData) {
  const assetId = String(formData.get("assetId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const next = safeNext(formData.get("next"), "/production");
  try {
    if (kind !== "style" && kind !== "character" && kind !== "environment") throw new Error("Choose a style, character, or environment reference.");
    const asset = getDb().prepare(`SELECT concept_id, organisation_id FROM generated_assets WHERE id = ?`).get(assetId) as
      | { concept_id: string | null; organisation_id: string | null }
      | undefined;
    if (!asset) throw new Error("That image is not stored.");
    getDb()
      .prepare(
        `INSERT INTO visual_anchors (id, asset_id, concept_id, organisation_id, kind, liked, reuse, status, approved_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'Hayden approved this for reuse.', ?, 'approved', 'hayden', ?)`,
      )
      .run(crypto.randomUUID(), assetId, asset.concept_id, asset.organisation_id, kind, kind, new Date().toISOString());
  } catch (error) {
    log.error("anchor approval failed", { error: error instanceof Error ? error.message : "anchor failed" });
    throw error;
  }
  finish(next);
}

export async function generateVisualStoryboard(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/production/${packId}/storyboard`);
  try {
    await generateStoryboard(getDb(), packId);
  } catch (error) {
    log.error("storyboard generation failed", { error: error instanceof Error ? error.message : "generation failed" });
    throw error;
  }
  finish(next);
}

export async function generateProductionFrames(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/production/${packId}`);
  try {
    await generateFrames(getDb(), packId);
  } catch (error) {
    log.error("frame generation failed", { error: error instanceof Error ? error.message : "generation failed" });
    throw error;
  }
  finish(next);
}

export async function regenerateProductionAsset(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), packId ? `/production/${packId}` : "/production");
  try {
    await regenerateAsset(getDb(), String(formData.get("assetId") ?? ""), String(formData.get("feedback") ?? ""));
  } catch (error) {
    log.error("image regeneration failed", { error: error instanceof Error ? error.message : "regeneration failed" });
    throw error;
  }
  finish(next);
}

export async function reviewProductionAsset(formData: FormData) {
  const next = safeNext(formData.get("next"), "/production");
  try {
    const decision = String(formData.get("decision") ?? "");
    if (decision !== "APPROVED" && decision !== "REJECTED") throw new Error("Approve or reject the file.");
    reviewAsset(getDb(), String(formData.get("assetId") ?? ""), decision);
  } catch (error) {
    log.error("image review failed", { error: error instanceof Error ? error.message : "review failed" });
    throw error;
  }
  finish(next);
}

export async function generateSceneVideoAction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), packId ? `/production/${packId}` : "/production");
  try {
    await generateSceneVideo(getDb(), packId, String(formData.get("sceneId") ?? ""));
  } catch (error) {
    log.error("scene video failed", { error: error instanceof Error ? error.message : "generation failed" });
    throw error;
  }
  finish(next);
}

export async function generatePackVideosAction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), packId ? `/production/${packId}` : "/production");
  try {
    await generateReadySceneVideos(getDb(), packId);
  } catch (error) {
    log.error("scene videos failed", { error: error instanceof Error ? error.message : "generation failed" });
    throw error;
  }
  finish(next);
}

export async function regenerateSceneVideoAction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), packId ? `/production/${packId}` : "/production");
  try {
    await regenerateSceneVideo(getDb(), String(formData.get("sceneId") ?? ""), String(formData.get("feedback") ?? ""));
  } catch (error) {
    log.error("scene video regeneration failed", { error: error instanceof Error ? error.message : "regeneration failed" });
    throw error;
  }
  finish(next);
}

export async function handoffWork(formData: FormData) {
  const next = safeNext(formData.get("next"), "/agents");
  try {
    await requestHandoff(getDb(), {
      fromAgentId: String(formData.get("fromAgentId") ?? ""),
      toAgentId: String(formData.get("toAgentId") ?? ""),
      objective: String(formData.get("objective") ?? ""),
      fromJobId: String(formData.get("fromJobId") ?? "") || null,
    });
  } catch (error) {
    log.error("agent handoff failed", { error: error instanceof Error ? error.message : "handoff failed" });
    throw error;
  }
  finish(next);
}

export async function assignExecutionAction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/work/pack/${packId}`);
  try {
    const { assignExecution } = await import("@/lib/work/execute");
    assignExecution(getDb(), packId, String(formData.get("ownerId") ?? ""));
  } catch (error) {
    log.error("assign execution failed", { error: error instanceof Error ? error.message : "assign failed" });
    throw error;
  }
  finish(next);
}

export async function startExecutionAction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/work/pack/${packId}`);
  try {
    const { startWork } = await import("@/lib/work/execute");
    startWork(getDb(), packId);
  } catch (error) {
    log.error("start execution failed", { error: error instanceof Error ? error.message : "start failed" });
    throw error;
  }
  finish(next);
}

export async function blockExecutionAction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/work/pack/${packId}`);
  try {
    const { markBlocked } = await import("@/lib/work/execute");
    markBlocked(getDb(), packId, String(formData.get("reason") ?? ""), String(formData.get("waitingOn") ?? ""));
  } catch (error) {
    log.error("block execution failed", { error: error instanceof Error ? error.message : "block failed" });
    throw error;
  }
  finish(next);
}

export async function noteExecutionAction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/work/pack/${packId}`);
  try {
    const { addWorkNote } = await import("@/lib/work/execute");
    addWorkNote(getDb(), packId, String(formData.get("authorId") ?? "executor"), String(formData.get("body") ?? ""));
  } catch (error) {
    log.error("work note failed", { error: error instanceof Error ? error.message : "note failed" });
    throw error;
  }
  finish(next);
}

export async function submitExecutionAction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/work/pack/${packId}`);
  try {
    const { storeDeliverableFile, submitWork } = await import("@/lib/work/execute");
    const file = formData.get("file");
    let filePath: string | null = null;
    let fileName: string | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > 80 * 1024 * 1024) throw new Error("That file is too large to store here.");
      fileName = file.name;
      filePath = storeDeliverableFile(packId, Buffer.from(await file.arrayBuffer()), fileName);
    }
    submitWork(getDb(), packId, {
      by: String(formData.get("ownerId") ?? "executor"),
      note: String(formData.get("note") ?? ""),
      link: String(formData.get("link") ?? ""),
      filePath,
      fileName,
    });
  } catch (error) {
    log.error("submit execution failed", { error: error instanceof Error ? error.message : "submit failed" });
    throw error;
  }
  finish(next);
}

export async function requestExecutionChangesAction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/work/pack/${packId}/review`);
  try {
    const { requestChanges } = await import("@/lib/work/execute");
    requestChanges(getDb(), packId, String(formData.get("feedback") ?? ""));
  } catch (error) {
    log.error("request changes failed", { error: error instanceof Error ? error.message : "changes failed" });
    throw error;
  }
  finish(next);
}

export async function approveExecutionAction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/work/pack/${packId}/review`);
  try {
    const { approveDeliverable } = await import("@/lib/work/execute");
    approveDeliverable(getDb(), packId);
  } catch (error) {
    log.error("approve deliverable failed", { error: error instanceof Error ? error.message : "approve failed" });
    throw error;
  }
  finish(next);
}

export async function saveRuleSuggestionAction(formData: FormData) {
  const next = safeNext(formData.get("next"), "/work");
  try {
    const { saveSuggestion } = await import("@/lib/work/rules");
    saveSuggestion(getDb(), String(formData.get("id") ?? ""));
  } catch (error) {
    log.error("save production rule failed", { error: error instanceof Error ? error.message : "rule failed" });
    throw error;
  }
  finish(next);
}

export async function dismissRuleSuggestionAction(formData: FormData) {
  const next = safeNext(formData.get("next"), "/work");
  try {
    const { dismissSuggestion } = await import("@/lib/work/rules");
    dismissSuggestion(getDb(), String(formData.get("id") ?? ""));
  } catch (error) {
    log.error("dismiss production rule failed", { error: error instanceof Error ? error.message : "dismiss failed" });
    throw error;
  }
  finish(next);
}

export async function returnExecutionToCreativeAction(formData: FormData) {
  const packId = String(formData.get("packId") ?? "");
  const next = safeNext(formData.get("next"), `/work/pack/${packId}`);
  try {
    const { returnWorkToCreative } = await import("@/lib/work/execute");
    await returnWorkToCreative(getDb(), packId, String(formData.get("reason") ?? ""));
  } catch (error) {
    log.error("return to creative failed", { error: error instanceof Error ? error.message : "return failed" });
    throw error;
  }
  finish(next);
}

export async function stageOperationsImport(formData: FormData) {
  const organisationId = String(formData.get("organisationId") ?? "");
  let id = "";
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV first.");
    if (file.size > 2 * 1024 * 1024) throw new Error("That file is too large for this import.");
    const { storeDraft } = await import("@/lib/ops/import");
    id = storeDraft(getDb(), organisationId, file.name, await file.text());
  } catch (error) {
    log.error("operations import failed", { error: error instanceof Error ? error.message : "import failed" });
    throw error;
  }
  finish(`/operations/import/${id}`);
}

export async function confirmOperationsImport(formData: FormData) {
  const draftId = String(formData.get("draftId") ?? "");
  try {
    const { getDraft, importAppointments } = await import("@/lib/ops/import");
    const draft = getDraft(getDb(), draftId);
    if (!draft) throw new Error("That import draft is not stored.");
    const mapping = {
      phone: String(formData.get("phone") ?? "") || undefined,
      name: String(formData.get("name") ?? "") || undefined,
      setter: String(formData.get("setter") ?? "") || undefined,
      appointment_at: String(formData.get("appointment_at") ?? "") || undefined,
      booked_at: String(formData.get("booked_at") ?? "") || undefined,
      status: String(formData.get("status") ?? "") || undefined,
      confirmation: String(formData.get("confirmation") ?? "") || undefined,
      partner: String(formData.get("partner") ?? "") || undefined,
      evidence: String(formData.get("evidence") ?? "") || undefined,
      evidence_type: String(formData.get("evidence_type") ?? "") || undefined,
      rebooking_attempted: String(formData.get("rebooking_attempted") ?? "") || undefined,
      campaign: String(formData.get("campaign") ?? "") || undefined,
      stage: String(formData.get("stage") ?? "") || undefined,
      tags: String(formData.get("tags") ?? "") || undefined,
    };
    importAppointments(getDb(), { organisationId: draft.organisation_id, fileName: draft.file_name, csvText: draft.csv_text, mapping, save: true });
  } catch (error) {
    log.error("operations import failed", { error: error instanceof Error ? error.message : "import failed" });
    throw error;
  }
  finish("/operations");
}

export async function confirmShowRateAction(formData: FormData) {
  const next = safeNext(formData.get("next"), "/operations");
  try {
    const { confirmShowRate } = await import("@/lib/ops/command");
    confirmShowRate(getDb(), String(formData.get("organisationId") ?? ""));
  } catch (error) {
    log.error("confirm show rate failed", { error: error instanceof Error ? error.message : "confirm failed" });
    throw error;
  }
  finish(next);
}

export async function saveOperationsTarget(formData: FormData) {
  const next = safeNext(formData.get("next"), "/operations");
  try {
    const { setTarget } = await import("@/lib/ops/kpis");
    setTarget(getDb(), {
      organisationId: String(formData.get("organisationId") ?? ""),
      kpiKey: String(formData.get("kpiKey") ?? ""),
      scopeType: String(formData.get("scopeType") ?? "organisation"),
      scopeLabel: String(formData.get("scopeLabel") ?? ""),
      periodLabel: String(formData.get("periodLabel") ?? ""),
      targetValue: Number(formData.get("targetValue")),
      targetUnit: String(formData.get("targetUnit") ?? "percent"),
      sourceName: String(formData.get("sourceName") ?? ""),
    });
  } catch (error) {
    log.error("save target failed", { error: error instanceof Error ? error.message : "target failed" });
    throw error;
  }
  finish(next);
}

export async function addManualAppointmentAction(formData: FormData) {
  const next = safeNext(formData.get("next"), "/operations");
  try {
    const { addManualAppointment } = await import("@/lib/ops/import");
    addManualAppointment(getDb(), {
      organisationId: String(formData.get("organisationId") ?? ""),
      scheduledAt: String(formData.get("scheduledAt") ?? ""),
      status: String(formData.get("status") ?? ""),
      setterName: String(formData.get("setterName") ?? ""),
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      evidence: String(formData.get("evidence") ?? ""),
      evidenceType: String(formData.get("evidenceType") ?? ""),
    });
  } catch (error) {
    log.error("manual appointment failed", { error: error instanceof Error ? error.message : "manual failed" });
    throw error;
  }
  finish(next);
}

export async function createFindingWorkAction(formData: FormData) {
  const next = safeNext(formData.get("next"), "/work");
  try {
    const { createWorkFromFinding } = await import("@/lib/ops/findings");
    createWorkFromFinding(getDb(), String(formData.get("findingId") ?? ""));
  } catch (error) {
    log.error("finding work failed", { error: error instanceof Error ? error.message : "work failed" });
    throw error;
  }
  finish(next);
}

export async function saveAircallAction(formData: FormData) {
  let notice = "Aircall is connected. Pull calls when you want them.";
  try {
    const { connectAircall } = await import("@/lib/integrations/aircall/sync");
    await connectAircall(getDb(), {
      organisationId: String(formData.get("organisationId") ?? ""),
      apiId: String(formData.get("apiId") ?? ""),
      apiToken: String(formData.get("apiToken") ?? ""),
    });
  } catch (error) {
    notice = error instanceof Error ? error.message : "Aircall could not be checked.";
    log.error("aircall connect failed", { error: notice });
  }
  finish(`/settings/integrations/aircall?notice=${encodeURIComponent(notice)}`);
}

export async function syncAircallAction() {
  let notice = "";
  try {
    const { runOpsSync } = await import("@/lib/ops/scheduler");
    notice = await runOpsSync();
  } catch (error) {
    notice = error instanceof Error ? error.message : "Aircall pull failed.";
    log.error("aircall sync failed", { error: notice });
  }
  finish(`/settings/integrations/aircall?notice=${encodeURIComponent(notice)}`);
}

export async function saveGhlAction(formData: FormData) {
  let notice = "GoHighLevel is connected. Pull contacts and appointments when you want them.";
  try {
    const { connectGhl } = await import("@/lib/integrations/ghl/sync");
    await connectGhl(getDb(), {
      organisationId: String(formData.get("organisationId") ?? ""),
      token: String(formData.get("token") ?? ""),
      locationId: String(formData.get("locationId") ?? ""),
    });
  } catch (error) {
    notice = error instanceof Error ? error.message : "GoHighLevel could not be checked.";
    log.error("ghl connect failed", { error: notice });
  }
  finish(`/settings/integrations/gohighlevel?notice=${encodeURIComponent(notice)}`);
}

export async function syncLiveOperationsAction() {
  let notice = "";
  try {
    const { runOpsSync } = await import("@/lib/ops/scheduler");
    const { capabilityRecords } = await import("@/lib/ops/capabilities");
    const { recordPipelineFinding } = await import("@/lib/ops/live");
    notice = await runOpsSync();
    const db = getDb();
    capabilityRecords(db);
    recordPipelineFinding(db);
  } catch (error) {
    notice = error instanceof Error ? error.message : "Live sync failed.";
    log.error("live operations sync failed", { error: notice });
  }
  finish(`/operations?notice=${encodeURIComponent(notice)}`);
}

export async function syncGhlAction() {
  let notice = "";
  try {
    const { runOpsSync } = await import("@/lib/ops/scheduler");
    notice = await runOpsSync();
  } catch (error) {
    notice = error instanceof Error ? error.message : "GoHighLevel pull failed.";
    log.error("ghl sync failed", { error: notice });
  }
  finish(`/settings/integrations/gohighlevel?notice=${encodeURIComponent(notice)}`);
}

export async function startGpuAction() {
  let notice = "";
  try {
    const { startGpu } = await import("@/lib/gpu/control");
    await startGpu(getDb());
  } catch (error) {
    notice = error instanceof Error ? error.message : "The GPU could not be started.";
    log.error("gpu start failed", { error: notice });
  }
  finish(notice ? `/production/gpu-test?notice=${encodeURIComponent(notice)}` : "/production/gpu-test");
}

export async function stopGpuAction() {
  let notice = "";
  try {
    const { stopGpu } = await import("@/lib/gpu/control");
    await stopGpu(getDb());
  } catch (error) {
    notice = error instanceof Error ? error.message : "The GPU could not be stopped.";
    log.error("gpu stop failed", { error: notice });
  }
  finish(notice ? `/production/gpu-test?notice=${encodeURIComponent(notice)}` : "/production/gpu-test");
}

export async function submitGpuRenderAction(formData: FormData) {
  let notice = "";
  try {
    const { submitRender } = await import("@/lib/gpu/control");
    const start = formData.get("start");
    if (!(start instanceof File) || start.size < 1) throw new Error("Choose a start frame.");
    if (start.size > 12_000_000) throw new Error("Use a start frame under 12 MB.");
    const type = start.type || "";
    if (type && !["image/png", "image/jpeg", "image/webp"].includes(type)) throw new Error("The start frame needs to be a PNG, JPEG, or WebP.");
    const end = formData.get("end");
    const seconds = Number(formData.get("seconds"));
    const aspect = String(formData.get("aspect") ?? "16:9");
    if (![5, 6, 8].includes(seconds)) throw new Error("Duration is 5, 6, or 8 seconds.");
    if (aspect !== "16:9" && aspect !== "9:16") throw new Error("Aspect is 16:9 or 9:16.");
    const seedRaw = String(formData.get("seed") ?? "").trim();
    const seed = seedRaw ? Number(seedRaw) : null;
    if (seed != null && (!Number.isInteger(seed) || seed < 0)) throw new Error("Seed needs to be a whole number.");
    await submitRender(getDb(), {
      prompt: String(formData.get("prompt") ?? ""),
      aspect,
      seconds,
      start: Buffer.from(await start.arrayBuffer()),
      end: end instanceof File && end.size > 0 ? Buffer.from(await end.arrayBuffer()) : null,
      seed,
    });
  } catch (error) {
    notice = error instanceof Error ? error.message : "The scene could not be sent.";
    log.error("gpu render failed", { error: notice });
  }
  finish(notice ? `/production/gpu-test?notice=${encodeURIComponent(notice)}` : "/production/gpu-test");
}

export async function reviewGpuRenderAction(formData: FormData) {
  let notice = "";
  try {
    const { reviewRender } = await import("@/lib/gpu/control");
    const decision = String(formData.get("decision") ?? "");
    if (decision !== "APPROVED" && decision !== "REJECTED") throw new Error("Approve or reject the clip.");
    await reviewRender(getDb(), String(formData.get("jobId") ?? ""), decision);
  } catch (error) {
    notice = error instanceof Error ? error.message : "The review could not be saved.";
    log.error("gpu review failed", { error: notice });
  }
  finish(notice ? `/production/gpu-test?notice=${encodeURIComponent(notice)}` : "/production/gpu-test");
}

export async function retryGpuRenderAction(formData: FormData) {
  let notice = "";
  try {
    const { retryRender } = await import("@/lib/gpu/control");
    await retryRender(getDb(), String(formData.get("jobId") ?? ""));
  } catch (error) {
    notice = error instanceof Error ? error.message : "The scene could not be run again.";
    log.error("gpu retry failed", { error: notice });
  }
  finish(notice ? `/production/gpu-test?notice=${encodeURIComponent(notice)}` : "/production/gpu-test");
}

export async function startNewContent(formData: FormData) {
  const idea = String(formData.get("idea") ?? "").trim();
  const id = createContentItem(getDb(), {
    idea,
    brandText: String(formData.get("brand") ?? ""),
    objective: String(formData.get("objective") ?? ""),
    audience: String(formData.get("audience") ?? ""),
    contentType: String(formData.get("contentType") ?? ""),
    platform: String(formData.get("platform") ?? ""),
    durationSeconds: Number(formData.get("duration") ?? "") || null,
    referenceNote: String(formData.get("reference") ?? ""),
  });
  try {
    await developConcept(getDb(), id);
    await writeScript(getDb(), id);
  } catch (error) {
    log.error("content start failed", { error: error instanceof Error ? error.message : "content failed" });
    throw error;
  }
  finish(`/production/content/${id}`);
}

export async function approveContentConcept(formData: FormData) {
  const id = String(formData.get("contentId") ?? "");
  approveConcept(getDb(), id);
  finish(`/production/content/${id}`);
}

export async function lockContentScript(formData: FormData) {
  const id = String(formData.get("contentId") ?? "");
  lockScript(getDb(), id);
  finish(`/production/content/${id}/look`);
}

export async function chooseContentStyle(formData: FormData) {
  const id = String(formData.get("contentId") ?? "");
  selectStyle(getDb(), id, String(formData.get("styleId") ?? ""));
  finish(`/production/content/${id}`);
}

export async function requestStoryboardPass(formData: FormData) {
  const id = String(formData.get("contentId") ?? "");
  newStoryboardPass(getDb(), id, String(formData.get("kind") ?? "SAME SCRIPT + SAME STYLE"));
  finish(`/production/content/${id}/board`);
}

export async function lockContentVisuals(formData: FormData) {
  const id = String(formData.get("contentId") ?? "");
  approveVisuals(getDb(), id);
  finish(`/production/content/${id}`);
}

export async function saveScriptEdit(formData: FormData) {
  const id = String(formData.get("contentId") ?? "");
  changeSpoken(getDb(), id, String(formData.get("spoken") ?? ""));
  finish(`/production/content/${id}`);
}

export async function proposeCustomStyle(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!name || !note) throw new Error("Name the look and describe the reference. It is not saved as a style yet.");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  getDb().prepare(
    `INSERT INTO style_templates (
      id, name, description, family, status, visual_medium, prompt_recipe, negative_constraints, generation_notes, created_at, updated_at
    ) VALUES (?, ?, ?, 'CUSTOM', 'proposed', 'To be confirmed', ?, 'Do not treat this as approved.', ?, ?, ?)`,
  ).run(id, name, note, note, "Waiting for Hayden to approve the style bible.", now, now);
  finish(`/production/styles/${id}`);
}

export async function approveCustomStyle(formData: FormData) {
  const id = String(formData.get("styleId") ?? "");
  getDb().prepare(`UPDATE style_templates SET status = 'approved', approved_by = 'hayden', updated_at = ? WHERE id = ? AND status = 'proposed'`).run(new Date().toISOString(), id);
  finish(`/production/styles/${id}`);
}

export async function archiveStyle(formData: FormData) {
  const id = String(formData.get("styleId") ?? "");
  getDb().prepare(`UPDATE style_templates SET status = 'archived', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  finish("/production/styles");
}

export async function duplicateStyle(formData: FormData) {
  const source = styleById(String(formData.get("styleId") ?? ""));
  if (!source) throw new Error("That style is not stored.");
  const id = `${source.id}-copy-${Date.now()}`;
  const now = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO style_templates (
      id, name, description, family, status, approved_by, visual_medium, prompt_recipe, negative_constraints, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'approved', 'hayden', ?, ?, ?, ?, ?)`,
  ).run(id, `${source.name} copy`, source.description, source.family, source.visualMedium, source.recipe, source.negative, now, now);
  finish(`/production/styles/${id}`);
}
