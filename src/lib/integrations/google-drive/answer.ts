import type Database from "better-sqlite3";
import { complete } from "@/lib/ai/provider";
import type { CommandAnswer } from "@/lib/command/answer";
import { formatShortDate } from "@/lib/dates";
import { retrieveKnowledge } from "@/lib/integrations/google-drive/retrieve";

export function isLivePerformanceQuestion(query: string) {
  const text = query.toLowerCase();
  return /meta|facebook ads|instagram ads/.test(text) && /perform|yesterday|result|cpl|spend|roas|how (are|did|is)|doing/.test(text);
}

export function isKnowledgeQuestion(query: string) {
  if (isLivePerformanceQuestion(query)) return false;
  const text = query.toLowerCase();
  return /document|script|sop|content plan|what did we (decide|say)|find the latest|documents mention|what are we currently producing|campaign strategy|street interview/.test(text);
}

export async function answerWithKnowledge(db: Database.Database, query: string): Promise<CommandAnswer> {
  if (isLivePerformanceQuestion(query)) {
    return {
      heading: "Meta",
      summary: "No live Meta Ads data is connected.",
      items: [
        {
          title: "What would be needed",
          detail: "A live Meta Ads connection, or a metric stored with data status live. A Drive document is not yesterday's result.",
          source: "integrations meta-ads",
          kind: "Unknown",
        },
      ],
    };
  }

  const retrieved = retrieveKnowledge(db, { query, limit: 4 });
  if (retrieved.excerpts.length === 0 && retrieved.brain.length === 0 && retrieved.records.length === 0) {
    return {
      heading: "Not stored",
      summary: "That is not stored in the Business brain or the indexed Drive documents.",
      items: [],
    };
  }

  const citations = retrieved.excerpts.map((item) => ({
    title: item.file.name,
    detail: `${item.excerpt} Modified: ${formatShortDate(item.modified)}.`,
    href: item.file.web_url ?? undefined,
    source: `Drive · ${item.file.drive_file_id}`,
    kind: "Drive",
  }));
  const brainItems = retrieved.brain.map((item) => ({
    title: item.title,
    detail: item.content.slice(0, 400),
    source: `knowledge ${item.id}`,
    kind: item.context_type === "DECISION" ? "Decision" : "Business brain",
  }));
  const recordItems = retrieved.records.map((item) => ({
    title: item.title,
    detail: item.detail,
    source: "hayden os",
    kind: item.kind,
  }));
  const grounded = await modelSummary(query, retrieved.conflictNote, citations.map((item) => `${item.title}: ${item.detail}`), brainItems.map((item) => item.detail));
  const names = retrieved.excerpts.map((item) => item.file.name).join("; ");
  const summary =
    retrieved.conflictNote ??
    grounded ??
    (names
      ? `Based on ${names}. A document is not automatically current strategy.`
      : "These are the stored sources. A document is not automatically current strategy.");
  return {
    heading: retrieved.conflict ? "Documents disagree" : "From stored knowledge",
    summary,
    items: [...citations, ...brainItems, ...recordItems],
  };
}

async function modelSummary(query: string, conflict: string | null, excerpts: string[], brain: string[]) {
  if (excerpts.length === 0) return null;
  const result = await complete({
    system:
      "Answer only from the excerpts and Business brain notes provided. Cite the document name. If two documents disagree, say so and quote both. Do not invent numbers, performance, or decisions. A document is not live advertising data and is not automatically current strategy. Return one short paragraph.",
    user: JSON.stringify({ query, conflict, excerpts, brain }),
  });
  if (!result.ok) return null;
  const text = result.text.replace(/\s+/g, " ").trim();
  const cited = excerpts.some((excerpt) => {
    const name = excerpt.split(":")[0] ?? "";
    return name.length > 3 && text.toLowerCase().includes(name.toLowerCase());
  });
  if (!cited) return null;
  if (conflict && excerpts.filter((excerpt) => text.toLowerCase().includes((excerpt.split(":")[0] ?? "").toLowerCase())).length < 2) return null;
  return text;
}

export function promoteDriveKnowledge(
  db: Database.Database,
  input: { fileId: string; title: string; content: string; contextType: string; approved: boolean },
) {
  if (!input.approved) throw new Error("Hayden has to approve this before it enters the Business brain.");
  const allowed = ["FACT", "STRATEGY", "PREFERENCE", "DECISION", "HYPOTHESIS", "HISTORICAL"];
  if (!allowed.includes(input.contextType)) throw new Error("That context type is not valid.");
  const file = db.prepare(`SELECT id, name, organisation_id, drive_file_id FROM drive_files WHERE id = ?`).get(input.fileId) as
    | { id: string; name: string; organisation_id: string | null; drive_file_id: string }
    | undefined;
  if (!file) throw new Error("That Drive file is not in the index.");
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || !content) throw new Error("A Business brain record needs a title and the text you are approving.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO knowledge (
      id, organisation_id, category, title, content, source, confidence, last_verified, created_at, updated_at,
      data_status, source_type, source_name, source_record, last_updated, context_type, effective_from
    ) VALUES (?, ?, 'drive', ?, ?, 'Drive document', 'medium', ?, ?, ?, 'manual', 'drive', ?, ?, ?, ?, ?)`,
  ).run(id, file.organisation_id, title, content, now.slice(0, 10), now, now, file.name, file.drive_file_id, now, input.contextType, now.slice(0, 10));
  return id;
}
