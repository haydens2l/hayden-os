import type Database from "better-sqlite3";
import { isCurrentContext } from "@/lib/brain/labels";
import { excerptFor, searchDriveFiles, type PublicDriveFile } from "@/lib/integrations/google-drive/store";
import type { Knowledge } from "@/lib/db/types";

export type KnowledgeExcerpt = {
  file: PublicDriveFile;
  excerpt: string;
  modified: string | null;
};

export type RetrievedKnowledge = {
  excerpts: KnowledgeExcerpt[];
  brain: Knowledge[];
  records: Array<{ kind: string; title: string; detail: string }>;
  conflict: boolean;
  conflictNote: string | null;
  freshness: string;
};

const STOP = new Set(["what", "that", "this", "with", "from", "have", "your", "about", "were", "does", "know", "said", "latest", "agreed", "there", "their", "would", "could", "should", "where", "which", "when"]);

export function retrieveKnowledge(
  db: Database.Database,
  input: { query: string; organisationId?: string | null; projectId?: string | null; categories?: string[]; limit?: number },
): RetrievedKnowledge {
  const matches = searchDriveFiles(db, { query: input.query, organisationId: input.organisationId ?? undefined, category: input.categories?.[0] });
  const projectFiltered = input.projectId ? matches.filter((item) => item.row.project_id === input.projectId || !item.row.project_id) : matches;
  const excerpts = projectFiltered.slice(0, input.limit ?? 4).map((item) => ({
    file: item.row,
    excerpt: excerptFor(item.row, input.query),
    modified: item.row.modified_time,
  }));
  const brain = relevantBrain(db, input.query).slice(0, 4);
  const records = structuredRecords(db, input.query);
  const conflict = documentsConflict(excerpts);
  const newest = excerpts[0]?.modified ?? null;
  return {
    excerpts,
    brain,
    records,
    conflict: conflict != null,
    conflictNote: conflict,
    freshness: newest ? `Newest matching document was modified ${newest}. Newer is preferred, and it is not treated as the decision unless the Business brain says so.` : "No matching document date is stored.",
  };
}

function structuredRecords(db: Database.Database, query: string) {
  const tokens = query.toLowerCase().split(/\W+/).filter((token) => token.length > 3 && !STOP.has(token));
  if (tokens.length === 0) return [];
  const tasks = db.prepare(`SELECT id, title, description FROM tasks WHERE status != 'done' LIMIT 80`).all() as Array<{
    id: string;
    title: string;
    description: string | null;
  }>;
  const decisions = db.prepare(`SELECT id, title, context FROM decisions WHERE status = 'open' LIMIT 40`).all() as Array<{
    id: string;
    title: string;
    context: string | null;
  }>;
  const hit = (text: string) => tokens.some((token) => text.toLowerCase().includes(token));
  return [
    ...tasks.filter((row) => hit(`${row.title} ${row.description ?? ""}`)).map((row) => ({ kind: "Task", title: row.title, detail: row.description ?? "No description stored." })),
    ...decisions.filter((row) => hit(`${row.title} ${row.context ?? ""}`)).map((row) => ({ kind: "Decision", title: row.title, detail: row.context ?? "No detail stored." })),
  ].slice(0, 4);
}

function relevantBrain(db: Database.Database, query: string) {
  const tokens = query.toLowerCase().split(/\W+/).filter((token) => token.length > 3 && !STOP.has(token));
  const rows = db.prepare(`SELECT * FROM knowledge WHERE superseded_by_id IS NULL`).all() as Knowledge[];
  return rows.filter((row) => {
    if (!isCurrentContext(row)) return false;
    const text = `${row.title} ${row.content}`.toLowerCase();
    return tokens.some((token) => text.includes(token));
  });
}

function documentsConflict(excerpts: KnowledgeExcerpt[]) {
  if (excerpts.length < 2) return null;
  const [first, second] = [...excerpts].sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
  const a = first.excerpt.toLowerCase();
  const b = second.excerpt.toLowerCase();
  const opposed =
    (a.includes("only") && (b.includes("among") || b.includes("several") || b.includes("not the only"))) ||
    (b.includes("only") && (a.includes("among") || a.includes("several") || a.includes("not the only"))) ||
    (a.includes("do not") && b.includes("should")) ||
    (b.includes("do not") && a.includes("should"));
  if (!opposed && similarity(a, b) > 0.45) return null;
  if (!opposed) return null;
  const newer = first.file.name;
  const older = second.file.name;
  return `Two documents contain different approaches. The newer document, ${newer}, says “${trimQuote(first.excerpt)}” while ${older} says “${trimQuote(second.excerpt)}”.`;
}

function trimQuote(value: string) {
  return value.replace(/\s+/g, " ").slice(0, 180);
}

function similarity(a: string, b: string) {
  const left = new Set(a.split(/\W+/).filter((token) => token.length > 3));
  const right = new Set(b.split(/\W+/).filter((token) => token.length > 3));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}
