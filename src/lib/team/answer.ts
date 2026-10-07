import type Database from "better-sqlite3";
import type { CommandAnswer } from "@/lib/command/answer";
import type { ReviewConcept } from "@/components/command/concept-review";
import { runProductionCommand } from "@/lib/executor/command";
import { coordinateBroadRequest } from "@/lib/team/coordinate";
import { isBroadTeamRequest, isProductionCommand, suggestAgent } from "@/lib/team/route";
import { assignAndRun, type AgentJob } from "@/lib/team/work";
import { answerVisual, isVisualRead } from "@/lib/visual/command";

export type TeamAction = {
  label: string;
  agentId: string;
  objective: string;
  requestedBy: string;
};

export type TeamAnswer = CommandAnswer & { actions?: TeamAction[]; review?: ReviewConcept[] };

export async function answerAsTeam(db: Database.Database, query: string): Promise<TeamAnswer> {
  if (/who should handle/i.test(query)) {
    const subject = query.replace(/who should handle( this)?\??/i, "").trim() || query;
    const suggestion = suggestAgent(subject);
    return {
      heading: "Chief of Staff",
      summary: `${suggestion.name} should handle it. ${suggestion.reason}`,
      items: [],
      actions: [
        {
          label: `Send to ${suggestion.name}`,
          agentId: suggestion.id,
          objective: subject,
          requestedBy: "chief-of-staff",
        },
      ],
    };
  }

  if (isVisualRead(query)) return answerVisual(db, query);

  if (isProductionCommand(query)) return runProductionCommand(db, query);

  if (isBroadTeamRequest(query)) return coordinateBroadRequest(db, query);

  const suggestion = suggestAgent(query);
  const job = await assignAndRun(db, {
    agentId: suggestion.id,
    objective: query,
    requestedBy: "hayden",
    requestedByLabel: "Hayden",
    reuse: true,
  });
  return answerFromJob(db, job);
}

export function answerFromJob(db: Database.Database, job: AgentJob): TeamAnswer {
  const concepts = db
    .prepare(
      `SELECT id, brand, title, hook, concept, script_outline, format, why_it_may_work, production_complexity, notes, approved_by
       FROM creative_concepts WHERE job_id = ? ORDER BY created_at`,
    )
    .all(job.id) as ReviewConcept[];
  if (concepts.length > 0) {
    return {
      heading: "Creative Director",
      summary: job.output_summary ?? "Concepts are saved for your approval.",
      items: [],
      review: concepts,
    };
  }
  const formats = db.prepare(`SELECT name, description, notes, status FROM media_formats WHERE job_id = ?`).all(job.id) as Array<{
    name: string;
    description: string | null;
    notes: string | null;
    status: string;
  }>;
  if (formats.length > 0) {
    return {
      heading: "Media Director",
      summary: job.output_summary ?? "Formats are stored as ideas.",
      items: formats.map((format) => ({
        title: format.name,
        detail: `${format.description ?? ""} ${format.notes ?? ""} Status: ${format.status}.`,
        source: `media_formats · requested by ${job.requested_by_label ?? job.requested_by}`,
        kind: "Format idea",
      })),
    };
  }
  return {
    heading:
      job.agent_id === "growth"
        ? "Growth Strategist"
        : job.agent_id === "creative"
          ? "Creative Director"
          : job.agent_id === "media"
            ? "Media Director"
            : job.agent_id === "content"
              ? "Content Factory"
              : "AI team",
    summary: job.output_summary ?? "No output was stored.",
    items: [
      {
        title: "Finding",
        detail: job.findings ?? "None",
        source: `${job.agent_id} · requested by ${job.requested_by_label ?? job.requested_by}`,
        kind: "Finding",
      },
      {
        title: "Recommendation",
        detail: job.recommendations ?? "None",
        source: job.id,
        kind: "Recommendation",
      },
    ],
  };
}
