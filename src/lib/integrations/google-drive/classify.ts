import type { Organisation, Project } from "@/lib/db/types";

export const KNOWLEDGE_CATEGORIES = [
  "STRATEGY",
  "CREATIVE",
  "CAMPAIGN",
  "SALES",
  "REPORT",
  "SOP",
  "MEETING",
  "FINANCIAL",
  "CONTENT",
  "RESEARCH",
  "CLIENT",
  "OPERATIONS",
  "OTHER",
  "UNKNOWN",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

const CATEGORY_TERMS: Array<[KnowledgeCategory, string[]]> = [
  ["STRATEGY", ["strategy", "positioning", "plan", "direction"]],
  ["CREATIVE", ["script", "hook", "creative", "storyboard", "shot list"]],
  ["CAMPAIGN", ["campaign", "media plan", "ad set"]],
  ["SALES", ["setter", "show rate", "objection", "sales"]],
  ["REPORT", ["report", "performance", "results", "dashboard"]],
  ["SOP", ["sop", "process", "checklist", "no-show", "no show"]],
  ["MEETING", ["meeting", "minutes", "transcript"]],
  ["FINANCIAL", ["invoice", "budget", "revenue", "margin", "p&l"]],
  ["CONTENT", ["content", "calendar", "caption", "producing"]],
  ["RESEARCH", ["research", "competitor", "interview notes"]],
  ["CLIENT", ["client", "onboarding"]],
  ["OPERATIONS", ["operations", "crm", "sla", "workflow"]],
];

export type Classification = {
  organisationId: string | null;
  brand: string | null;
  projectId: string | null;
  category: KnowledgeCategory;
  confidence: "high" | "medium" | "low";
};

export function classifyDocument(
  input: { name: string; folderPath: string | null; text: string | null },
  organisations: Array<Pick<Organisation, "id" | "name" | "slug" | "type">>,
  projects: Array<Pick<Project, "id" | "name">>,
): Classification {
  const haystack = `${input.name} ${input.folderPath ?? ""}`.toLowerCase();
  const body = (input.text ?? "").slice(0, 4000).toLowerCase();
  const org = matchOrg(haystack, body, organisations);
  const project = projects.find((item) => item.name.length > 4 && haystack.includes(item.name.toLowerCase())) ?? null;
  const category = matchCategory(`${haystack} ${body}`);
  const confidence = org.where === "name" ? "high" : org.where === "body" ? "medium" : "low";
  return {
    organisationId: org.id,
    brand: org.type === "brand" ? org.name : null,
    projectId: project?.id ?? null,
    category: confidence === "low" && category.score < 2 ? "UNKNOWN" : category.label,
    confidence,
  };
}

function matchOrg(
  name: string,
  body: string,
  organisations: Array<Pick<Organisation, "id" | "name" | "slug" | "type">>,
) {
  const ranked = organisations
    .map((org) => ({ org, tokens: [org.name.toLowerCase(), org.slug.replaceAll("-", " ")] }))
    .sort((a, b) => b.org.name.length - a.org.name.length);
  for (const item of ranked) {
    if (item.tokens.some((token) => token.length > 2 && name.includes(token))) {
      return { id: item.org.id, name: item.org.name, type: item.org.type, where: "name" as const };
    }
  }
  for (const item of ranked) {
    if (item.tokens.some((token) => token.length > 2 && body.includes(token))) {
      return { id: item.org.id, name: item.org.name, type: item.org.type, where: "body" as const };
    }
  }
  return { id: null, name: null, type: null, where: "none" as const };
}

function matchCategory(text: string) {
  let best: KnowledgeCategory = "OTHER";
  let score = 0;
  for (const [category, terms] of CATEGORY_TERMS) {
    const hits = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
    if (hits > score) {
      score = hits;
      best = category;
    }
  }
  if (score === 0) return { label: "UNKNOWN" as KnowledgeCategory, score: 0 };
  return { label: best, score };
}
