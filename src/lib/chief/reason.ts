import type Database from "better-sqlite3";
import { brisbaneToday } from "@/lib/dates";
import { classifyAttention, ignoreWindowFor, priorityScore, type AttentionClass, type Factors } from "@/lib/priority/engine";
import { humanToken } from "@/lib/brain/labels";
import { retrieveContext, type ChiefContext, type IssueRow, type OpportunityRow, type OrgRow, type PersonRow, type ProjectRow, type WorkRow } from "@/lib/chief/retrieve";
import { ATTENTION_BUDGET, type IgnoreLine, type MorningBrief, type Recommendation, type WatchLine } from "@/lib/chief/types";

const MATERIAL = /legal|compliance|asic|lawsuit|personnel|resign|resigned|fired|client at risk|major client|refund|revenue at risk|systemic|outage|cannot operate|financial risk/i;
const OPERATIONAL = /crm|cleanup|clean up|hygiene|data entry|follow-up|follow up|reminder|admin|routine|export|caption|resize|setter issue/i;
const APPROVAL = /approv|sign off|sign-off|creative direction/i;
const TOKENS = ["production", "execution", "content", "advertising", "crm", "hygiene", "data", "systems", "documentation", "automation", "admin", "setter", "coaching", "kpi", "video", "finance", "commercial"];

type Distance = "low" | "normal" | "high";

type Draft = {
  rec: Recommendation;
  operational: boolean;
  distance: Distance;
  createdAt: string;
  blocked: boolean;
  overdue: boolean;
  ownerName: string | null;
};

export function buildMorningBrief(db: Database.Database): MorningBrief {
  return compose(retrieveContext(db));
}

export function compose(context: ChiefContext): MorningBrief {
  const orgs = new Map(context.organisations.map((org) => [org.id, org]));
  const drafts: Draft[] = [
    ...context.tasks.map((task) => fromWork(task, "task", orgs, context)),
    ...context.decisions.map((decision) => fromWork(decision, "decision", orgs, context)),
    ...context.opportunities.map((opportunity) => fromOpportunity(opportunity, orgs, context)),
    ...context.issues.map((issue) => fromIssue(issue, orgs, context)),
    ...context.projects.filter((project) => waitingOnHayden(project)).map((project) => fromProject(project, orgs, context)),
  ];

  const moves = drafts
    .filter((draft) => draft.rec.recommendedClassification === "hayden_now" || draft.rec.recommendedClassification === "hayden_soon")
    .sort(byRank)
    .slice(0, ATTENTION_BUDGET)
    .map((draft) => draft.rec);
  const moveIds = new Set(moves.map((move) => move.id));

  const watching: WatchLine[] = drafts
    .filter((draft) => !moveIds.has(draft.rec.id) && (draft.rec.recommendedClassification === "hayden_now" || draft.rec.recommendedClassification === "hayden_soon"))
    .sort(byRank)
    .map((draft) => ({
      id: draft.rec.id,
      text: `Also needs you, outside today's three: ${draft.rec.title}${draft.rec.business ? ` (${draft.rec.business})` : ""}.`,
    }));

  const handled = handledLines(drafts);
  const ignore = ignoreLines(drafts, orgs);
  const bottlenecks = bottleneckLines(context.projects, drafts);
  const stale = staleLines(context);
  const changed = changeLines(context, drafts);
  const decisions = drafts
    .filter((draft) => draft.rec.entityType === "decision" && isHaydenClass(draft.rec.recommendedClassification))
    .sort(byRank)
    .map((draft) => draft.rec);
  const opportunities = drafts
    .filter((draft) => draft.rec.entityType === "opportunity" && isHaydenClass(draft.rec.recommendedClassification))
    .sort(byRank)
    .slice(0, 3)
    .map((draft) => draft.rec);

  const recommendations = drafts.map((draft) => draft.rec);
  const headline = headlineFor(moves, handled);

  return {
    headline,
    moves,
    changed,
    handled,
    watching,
    decisions,
    opportunities,
    ignore,
    bottlenecks,
    stale,
    recommendations,
    weekly: {
      generatedOn: context.today,
      haydenAttention: moves.map((move) => move.title),
      delegated: drafts.filter((draft) => draft.rec.recommendedClassification === "delegate").map((draft) => draft.rec.title),
      blocked: context.projects.filter((project) => project.status === "blocked" || project.status === "waiting").map((project) => project.name),
      opportunities: opportunities.map((item) => item.title),
      decisions: decisions.map((item) => item.title),
      ignored: ignore.map((item) => item.what),
    },
    confidence: recommendations.every((item) => item.evidence.length > 0) ? "high" : "medium",
    context: {
      counts: {
        organisations: context.organisations.length,
        people: context.people.length,
        tasks: context.tasks.length,
        decisions: context.decisions.length,
        projects: context.projects.length,
        opportunities: context.opportunities.length,
        issues: context.issues.length,
        metrics: context.metrics.length,
        knowledge: context.knowledge.length,
      },
      ids: {
        tasks: context.tasks.map((item) => item.id),
        decisions: context.decisions.map((item) => item.id),
        projects: context.projects.map((item) => item.id),
        opportunities: context.opportunities.map((item) => item.id),
        issues: context.issues.map((item) => item.id),
        metrics: context.metrics.map((item) => item.id),
        knowledge: context.knowledge.map((item) => item.id),
      },
    },
  };
}

export function renderBriefText(brief: MorningBrief) {
  const lines = [
    "GOOD MORNING HAYDEN",
    "",
    "THE 30-SECOND VERSION",
    brief.headline,
    "",
    "YOUR THREE MOVES",
    brief.moves.length === 0 ? "Nothing stored needs you." : brief.moves.map(renderMove).join("\n\n"),
    "",
    "WHAT CHANGED",
    brief.changed.join("\n"),
    "",
    "BEING HANDLED",
    brief.handled.length === 0 ? "Nothing meaningful is stored with other people." : brief.handled.map((line) => `${line.who} — ${line.what} — ${line.note}`).join("\n"),
    "",
    "WATCHING",
    brief.watching.length === 0 ? "Nothing else is worth watching." : brief.watching.map((line) => line.text).join("\n"),
    "",
    "DECISIONS",
    brief.decisions.length === 0 ? "No founder decision is waiting." : brief.decisions.map((item) => item.title).join("\n"),
    "",
    "OPPORTUNITIES",
    brief.opportunities.length === 0 ? "No meaningful opportunity is stored." : brief.opportunities.map((item) => item.title).join("\n"),
    "",
    "WHAT I WOULD IGNORE TODAY",
    brief.ignore.length === 0 ? "No operational cluster is crowding the day." : brief.ignore.map((item) => `${item.what} ${item.why}`).join("\n"),
  ];
  if (brief.bottlenecks.length > 0) {
    lines.push("", "FOUNDER BOTTLENECKS", brief.bottlenecks.join("\n"));
  }
  if (brief.stale.length > 0) {
    lines.push("", "STALE FIGURES", brief.stale.map((item) => item.detail).join("\n"));
  }
  return lines.join("\n");
}

function renderMove(move: Recommendation) {
  return [
    `ACTION: ${move.action}`,
    `BUSINESS: ${move.business ?? "No business"}`,
    `WHY IT MATTERS: ${move.why}`,
    `EXPECTED OUTCOME: ${move.expectedOutcome}`,
    `ESTIMATED HAYDEN TIME: ${move.haydenTime}`,
    `RECOMMENDED NEXT STEP: ${move.nextStep}`,
  ].join("\n");
}

function fromWork(row: WorkRow, entityType: "task" | "decision", orgs: Map<string, OrgRow>, context: ChiefContext): Draft {
  const org = row.organisation_id ? orgs.get(row.organisation_id) ?? null : null;
  const factors = factorsOf(row);
  const ownerIsHayden = !row.owner_id || (entityType === "decision" && row.owner_id === "hayden") || (entityType === "task" && row.owner_id === "hayden");
  const needsDecision = entityType === "decision" && row.status === "open" && ownerIsHayden && row.delegated !== 1;
  const text = `${row.title} ${row.description ?? ""} ${row.recommended_action ?? ""}`;
  const material = isMaterial(text, factors.risk, null);
  const operational = entityType === "task" && (OPERATIONAL.test(text) || factors.strategicImportance <= 2);
  const assessment = classifyAttention({
    factors,
    needsHaydenDecision: needsDecision,
    humanCanHandle: Boolean(row.owner_id) && row.owner_id !== "hayden",
    agentCouldHandle: entityType === "task" && factors.haydenDependency <= 1,
    alreadyHandled: Boolean(row.owner_id) && row.owner_id !== "hayden" && !["done", "dismissed"].includes(row.status),
    delegated: row.delegated === 1,
    deferred: row.status === "deferred",
    overdue: Boolean(row.due_date && row.due_date < context.today && !["done", "dismissed"].includes(row.status)),
    blocked: row.status === "blocked",
    highRisk: factors.risk >= 4,
    haydenAuthority: entityType === "task" ? row.requires_hayden === 1 || row.owner_id === "hayden" : ownerIsHayden && row.status !== "deferred",
    ignore24h: row.status === "deferred" ? "nothing" : ignoreWindowFor(factors, needsDecision),
  });
  const distance = founderDistance(org);
  const founderKeeps = needsDecision || (APPROVAL.test(text) && distance === "high");
  const fit = founderKeeps ? null : bestOwner(text, row.organisation_id, context.people);
  let recommended = assessment.classification;
  let changeReason: string | null = null;
  if (!founderKeeps && distance === "low" && operational && !material) {
    recommended = row.owner_id && row.owner_id !== "hayden" ? (assessment.classification === "ignore" ? "ignore" : "delegate") : fit ? "delegate" : "ignore";
    if (recommended !== assessment.classification) {
      changeReason = `${org?.name ?? "This business"} is stored with low founder involvement. The item is operational and it is not a financial, client, legal, personnel, or commercial risk.`;
    }
  } else if (!founderKeeps && entityType === "task" && row.owner_id === "hayden" && fit && operational && !material) {
    recommended = "delegate";
    changeReason = `${fit.name} can own this from the stored responsibilities. Hayden does not uniquely need to do it.`;
  }
  const owner = recommended === "delegate" && fit ? fit : recommended === "delegate" && row.owner_id && row.owner_id !== "hayden" ? context.people.find((person) => person.id === row.owner_id) ?? null : context.people.find((person) => person.id === "hayden") ?? null;
  const brain = brainLines(org);
  const rec = recommendation({
    id: row.id,
    entityType,
    title: row.title,
    business: row.organisation_name,
    organisationId: row.organisation_id,
    action: entityType === "decision" ? row.title : row.title,
    why: whyText(org, row.owner_name, operational, material, needsDecision, distance),
    expectedOutcome: row.expected_outcome?.trim() || (entityType === "decision" ? "A founder decision is recorded." : "The work is finished by the owner."),
    haydenTime: row.estimated_minutes ? `${row.estimated_minutes} minutes` : "Not estimated.",
    nextStep: row.recommended_action?.trim() || (entityType === "decision" ? "Record the decision." : "Open the record."),
    originalClassification: assessment.classification,
    recommendedClassification: recommended,
    changeReason,
    confidence: org ? "high" : "medium",
    recommendedOwnerId: owner?.id ?? null,
    recommendedOwnerName: owner?.name ?? null,
    ownerReason: ownerReason(owner, recommended, changeReason, row.owner_name),
    suggestedDeadline: row.due_date,
    evidence: [{ type: entityType, id: row.id, label: row.title }],
    brain,
    reachedHaydenBecause: reached(recommended, distance, material, needsDecision),
    rank: rankScore(assessment.score, org, material, recommended),
    material,
    dataStatus: row.data_status,
  });
  return {
    rec,
    operational,
    distance,
    createdAt: row.created_at,
    blocked: row.status === "blocked",
    overdue: Boolean(row.due_date && row.due_date < context.today),
    ownerName: row.owner_name,
  };
}

function fromOpportunity(row: OpportunityRow, orgs: Map<string, OrgRow>, context: ChiefContext): Draft {
  const org = row.organisation_id ? orgs.get(row.organisation_id) ?? null : null;
  const distance = founderDistance(org);
  const text = `${row.title} ${row.description ?? ""} ${row.recommended_action ?? ""} ${row.category ?? ""}`;
  const approval = APPROVAL.test(text) || /hayden/i.test(row.recommended_action ?? "");
  const material = isMaterial(text, 0, null);
  const recommended: AttentionClass = approval && distance !== "low" ? "hayden_now" : row.owner_id && row.owner_id !== "hayden" ? "delegate" : "monitor";
  const factors: Factors = {
    financialImpact: 3,
    urgency: approval ? 4 : 2,
    strategicImportance: Math.min(5, org?.strategic_priority ?? 3),
    haydenDependency: approval ? 5 : 2,
    risk: material ? 4 : 1,
    timeCost: 1,
  };
  const brain = brainLines(org);
  const rec = recommendation({
    id: row.id,
    entityType: "opportunity",
    title: row.title,
    business: row.organisation_name,
    organisationId: row.organisation_id,
    action: row.title,
    why: `${whyText(org, row.owner_name, false, material, approval, distance)} No revenue figure is stored on this opportunity.`,
    expectedOutcome: row.recommended_action?.trim() || "The opportunity is either taken or left.",
    haydenTime: "Not estimated.",
    nextStep: row.recommended_action?.trim() || "Open the opportunity.",
    originalClassification: "not_scored",
    recommendedClassification: recommended,
    changeReason: recommended === "hayden_now" ? "The priority engine has not scored this opportunity. It needs founder approval on a high-priority business." : null,
    confidence: org ? "high" : "medium",
    recommendedOwnerId: "hayden",
    recommendedOwnerName: context.people.find((person) => person.id === "hayden")?.name ?? "Hayden",
    ownerReason: approval ? "Stored as needing Hayden's approval." : "No other owner is stored as able to close it.",
    suggestedDeadline: null,
    evidence: [{ type: "opportunity", id: row.id, label: row.title }],
    brain,
    reachedHaydenBecause: approval ? "It asks for founder approval on a business with high stored strategic priority." : "It is stored, and it does not yet ask for you.",
    rank: rankScore(priorityScore(factors), org, material, recommended),
    material,
    dataStatus: row.data_status,
  });
  return { rec, operational: false, distance, createdAt: row.created_at, blocked: false, overdue: false, ownerName: row.owner_name };
}

function fromIssue(row: IssueRow, orgs: Map<string, OrgRow>, context: ChiefContext): Draft {
  const org = row.organisation_id ? orgs.get(row.organisation_id) ?? null : null;
  const distance = founderDistance(org);
  const text = `${row.title} ${row.description ?? ""} ${row.category ?? ""}`;
  const material = isMaterial(text, 0, row.severity) || row.requires_hayden === 1;
  const operational = !material && (OPERATIONAL.test(text) || distance === "low");
  const fit = bestOwner(text, row.organisation_id, context.people);
  const recommended: AttentionClass = material ? "hayden_now" : operational ? "delegate" : "monitor";
  const owner = recommended === "delegate" ? fit ?? context.people.find((person) => person.id === row.assigned_to) ?? null : context.people.find((person) => person.id === "hayden") ?? null;
  const rec = recommendation({
    id: row.id,
    entityType: "issue",
    title: row.title,
    business: row.organisation_name,
    organisationId: row.organisation_id,
    action: row.title,
    why: whyText(org, row.assignee_name, operational, material, false, distance),
    expectedOutcome: material ? "The risk is acknowledged by Hayden." : "The owner handles it without Hayden.",
    haydenTime: "Not estimated.",
    nextStep: "Read the issue.",
    originalClassification: "not_scored",
    recommendedClassification: recommended,
    changeReason: null,
    confidence: "medium",
    recommendedOwnerId: owner?.id ?? null,
    recommendedOwnerName: owner?.name ?? null,
    ownerReason: owner ? `Stored responsibilities point to ${owner.name}.` : "No owner fit is stored.",
    suggestedDeadline: null,
    evidence: [{ type: "issue", id: row.id, label: row.title }],
    brain: brainLines(org),
    reachedHaydenBecause: material ? "The issue is a material risk." : "It stays off your list.",
    rank: rankScore(material ? 30 : 8, org, material, recommended),
    material,
    dataStatus: row.data_status,
  });
  return { rec, operational, distance, createdAt: row.detected_at, blocked: false, overdue: false, ownerName: row.assignee_name };
}

function fromProject(row: ProjectRow, orgs: Map<string, OrgRow>, context: ChiefContext): Draft {
  const org = row.organisation_id ? orgs.get(row.organisation_id) ?? null : null;
  const distance = founderDistance(org);
  const links = context.driveLinks.filter((link) => link.project_id === row.id);
  const linkNote = links.length > 0 ? ` Linked Drive source: ${links.map((link) => link.label).join(", ")}.` : "";
  const rec = recommendation({
    id: row.id,
    entityType: "project",
    title: row.name,
    business: row.organisation_name,
    organisationId: row.organisation_id,
    action: row.next_action?.trim() || row.name,
    why: `${row.name} is ${row.status} and stored as waiting on Hayden. ${brainLines(org)[0] ?? "No strategy record is stored for this business."}${linkNote}`,
    expectedOutcome: "The project can move without sitting on Hayden.",
    haydenTime: "Not estimated.",
    nextStep: row.next_action?.trim() || "Unblock the project or name another owner.",
    originalClassification: "not_scored",
    recommendedClassification: "hayden_now",
    changeReason: "The priority engine does not score projects. This one cannot progress without founder input.",
    confidence: "high",
    recommendedOwnerId: "hayden",
    recommendedOwnerName: context.people.find((person) => person.id === "hayden")?.name ?? "Hayden",
    ownerReason: "The project is waiting on Hayden.",
    suggestedDeadline: null,
    evidence: [{ type: "project", id: row.id, label: row.name }, ...links.map((link) => ({ type: "drive", id: row.id, label: link.label }))],
    brain: brainLines(org),
    reachedHaydenBecause: "The project cannot progress without founder input.",
    rank: rankScore(28, org, false, "hayden_now"),
    material: false,
    dataStatus: row.data_status,
  });
  return { rec, operational: false, distance, createdAt: row.updated_at, blocked: row.status === "blocked" || row.status === "waiting", overdue: false, ownerName: row.owner_name };
}

function recommendation(input: Recommendation): Recommendation {
  if (input.originalClassification === input.recommendedClassification) input.changeReason = null;
  return input;
}

function waitingOnHayden(project: ProjectRow) {
  if (["completed", "cancelled", "idea"].includes(project.status)) return false;
  const involvement = (project.hayden_involvement ?? "").toLowerCase();
  const waiting = project.status === "waiting" || project.status === "blocked";
  const founder = project.owner_id === "hayden" || /approval|required|founder|hayden/.test(involvement);
  return waiting && founder;
}

function founderDistance(org: OrgRow | null): Distance {
  if (!org) return "normal";
  const priority = org.strategic_priority ?? 3;
  const intent = (org.growth_intent ?? "").toUpperCase();
  const involvement = (org.desired_hayden_involvement ?? "").toLowerCase();
  if (priority <= 2 || involvement.startsWith("low") || intent.includes("REDUCE")) return "low";
  if (priority >= 4 || intent.includes("AGGRESSIVE") || /\bGROW\b/.test(intent)) return "high";
  return "normal";
}

function isMaterial(text: string, risk: number, severity: string | null) {
  if (risk >= 4) return true;
  if (severity && /critical|high/.test(severity)) return true;
  return MATERIAL.test(text);
}

function bestOwner(text: string, organisationId: string | null, people: PersonRow[]) {
  const haystack = text.toLowerCase();
  let winner: PersonRow | null = null;
  let best = 0;
  for (const person of people) {
    if (person.id === "hayden") continue;
    const notes = person.notes ?? "";
    const skipTrajectory = /has not happened|move has not happened/i.test(notes);
    const blob = `${person.role ?? ""} ${person.responsibilities ?? ""} ${skipTrajectory ? "" : notes}`.toLowerCase();
    let score = 0;
    for (const token of TOKENS) {
      if (haystack.includes(token) && blob.includes(token)) score += 3;
    }
    if (organisationId && person.organisation_id === organisationId) score += 2;
    if (score > best) {
      best = score;
      winner = person;
    }
  }
  return best >= 3 ? winner : null;
}

function brainLines(org: OrgRow | null) {
  if (!org) return ["No business strategy record is stored for this item."];
  return [
    `${org.name}: strategic priority ${org.strategic_priority ?? "unset"}, growth intent ${label(org.growth_intent)}, founder involvement ${firstSentence(org.desired_hayden_involvement)}`,
  ];
}

function whyText(org: OrgRow | null, owner: string | null, operational: boolean, material: boolean, needsHayden: boolean, distance: Distance) {
  const strategy = brainLines(org)[0];
  const kind = material ? "It is a material risk." : operational ? "It is operational." : needsHayden ? "It is a founder decision." : "It is stored work.";
  const day = material || needsHayden ? "Leaving it for 24 hours stalls something only a founder record can close." : "Leaving it for 24 hours does not create a stored material risk.";
  const weight = distance === "low" ? "Record count on this business does not raise its claim on Hayden." : "Stored strategic priority is what gives it weight.";
  return [strategy, kind, owner ? `Current owner: ${owner}.` : "No owner is stored.", day, weight].join(" ");
}

function reached(recommended: AttentionClass, distance: Distance, material: boolean, needsHayden: boolean) {
  if (recommended === "hayden_now" || recommended === "hayden_soon") {
    if (needsHayden) return "Hayden uniquely needs to decide, and the business strategy supports that.";
    if (material) return "It is a material risk, so it reaches Hayden even on a low-involvement business.";
    return "It still needs Hayden after delegation was checked.";
  }
  if (distance === "low") return "It stays off Hayden because the business is stored with low founder involvement and the item is not a material risk.";
  return "Someone else can carry it, so it does not take a founder slot.";
}

function ownerReason(owner: PersonRow | null, recommended: AttentionClass, changeReason: string | null, current: string | null) {
  if (recommended === "delegate" && owner) return changeReason ?? `${owner.name} already owns it.`;
  if (current && recommended !== "delegate") return "Hayden is the stored owner because the item needs a founder.";
  return owner ? `Recommended owner: ${owner.name}.` : "No alternative owner is stored.";
}

function rankScore(score: number, org: OrgRow | null, material: boolean, recommended: AttentionClass) {
  const priority = org?.strategic_priority ?? 0;
  const intent = (org?.growth_intent ?? "").toUpperCase();
  let rank = score + priority * 5;
  if (intent.includes("AGGRESSIVE")) rank += 12;
  else if (/\bGROW\b/.test(intent)) rank += 6;
  if (intent.includes("REDUCE")) rank -= 15;
  if (material) rank += 10;
  if (recommended !== "hayden_now" && recommended !== "hayden_soon") rank -= 40;
  if (recommended === "hayden_soon") rank -= 5;
  return rank;
}

function byRank(a: Draft, b: Draft) {
  return b.rec.rank - a.rec.rank || a.rec.title.localeCompare(b.rec.title);
}

function isHaydenClass(value: AttentionClass) {
  return value === "hayden_now" || value === "hayden_soon";
}

function handledLines(drafts: Draft[]) {
  const groups = new Map<string, { who: string; what: string; count: number; blocked: number }>();
  for (const draft of drafts) {
    if (draft.rec.recommendedClassification !== "delegate" && draft.rec.recommendedClassification !== "monitor") continue;
    const who = draft.rec.recommendedClassification === "delegate" ? draft.rec.recommendedOwnerName ?? draft.ownerName : draft.ownerName;
    if (!who || who === "Hayden Pawelski" || who === "Hayden") continue;
    if (draft.rec.recommendedClassification === "monitor" && draft.distance !== "low") continue;
    const key = `${who}|${draft.rec.business ?? "No business"}`;
    const current = groups.get(key) ?? { who, what: draft.rec.business ?? "No business", count: 0, blocked: 0 };
    current.count += 1;
    if (draft.blocked || draft.overdue) current.blocked += 1;
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => ({
    who: group.who,
    what: group.what,
    note: group.blocked > 0 ? `${group.count} items, ${group.blocked} overdue or blocked.` : `${group.count} item${group.count === 1 ? "" : "s"}. Not waiting on you.`,
  }));
}

function ignoreLines(drafts: Draft[], orgs: Map<string, OrgRow>): IgnoreLine[] {
  const groups = new Map<string, { org: OrgRow | null; count: number; sample: string; owner: string | null }>();
  for (const draft of drafts) {
    if (draft.distance !== "low" || !draft.operational || draft.rec.material) continue;
    if (draft.rec.recommendedClassification === "hayden_now") continue;
    const key = draft.rec.organisationId ?? "none";
    const current = groups.get(key) ?? { org: draft.rec.organisationId ? orgs.get(draft.rec.organisationId) ?? null : null, count: 0, sample: draft.rec.title, owner: draft.ownerName };
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => {
    const name = group.org?.name ?? "That business";
    const crm = /crm|cleanup|clean up/i.test(group.sample);
    return {
      id: `ignore-${group.org?.id ?? "none"}`,
      what: crm ? `Routine ${name} CRM cleanup.` : `Routine ${name} operational work.`,
      why: `${group.count} item${group.count === 1 ? "" : "s"} ${group.owner ? `sit with ${group.owner}` : "have another owner"}. ${name} is stored as ${label(group.org?.strategic_role)}, strategic priority ${group.org?.strategic_priority ?? "unset"}, growth intent ${label(group.org?.growth_intent)}, with founder involvement ${firstSentence(group.org?.desired_hayden_involvement)} None of these items is a financial, client, legal, personnel, or commercial issue.`,
    };
  });
}

function bottleneckLines(projects: ProjectRow[], drafts: Draft[]) {
  const waiting = projects.filter(waitingOnHayden);
  const lines: string[] = [];
  if (waiting.length >= 3) {
    lines.push("You're becoming the bottleneck here.");
    lines.push(waiting.map((project) => `${project.name}${project.organisation_name ? ` (${project.organisation_name})` : ""} is ${project.status}.`).join(" "));
  }
  const operationalOnHayden = drafts.filter((draft) => draft.rec.entityType === "task" && draft.operational && draft.rec.recommendedOwnerId === "hayden" && isHaydenClass(draft.rec.recommendedClassification));
  if (operationalOnHayden.length >= 4) {
    lines.push("You're becoming the bottleneck here.");
    lines.push(`${operationalOnHayden.length} operational tasks are still landing on Hayden.`);
  }
  return lines;
}

function staleLines(context: ChiefContext) {
  return context.metrics
    .map((metric) => {
      const age = metric.last_updated ? daysBetween(metric.last_updated, context.today) : metric.metric_date ? daysBetween(metric.metric_date, context.today) : null;
      const marked = metric.data_status === "stale";
      const old = age != null && age > 7 && metric.data_status !== "live";
      if (!marked && !old) return null;
      const ageText = age == null ? "No updated time is stored." : `The most recent figure stored for ${metric.label} is ${age} days old.`;
      return {
        label: metric.label,
        detail: `${ageText} It is stale and is not a current result.${metric.organisation_name ? ` Business: ${metric.organisation_name}.` : ""}`,
      };
    })
    .filter((line): line is { label: string; detail: string } => Boolean(line));
}

function changeLines(context: ChiefContext, drafts: Draft[]) {
  if (!context.previousGeneratedAt) return ["No earlier brief is stored. This is the first comparison point."];
  const meaningful = drafts.filter((draft) => {
    if (draft.createdAt <= context.previousGeneratedAt!) return draft.blocked || draft.overdue;
    return draft.rec.material || draft.rec.entityType === "decision" || draft.rec.entityType === "opportunity" || draft.blocked;
  });
  if (meaningful.length === 0) return ["No meaningful change is stored since the previous brief."];
  return meaningful.slice(0, 5).map((draft) => {
    if (draft.createdAt > context.previousGeneratedAt!) return `New ${draft.rec.entityType}: ${draft.rec.title}.`;
    if (draft.blocked) return `${draft.rec.title} is blocked.`;
    return `${draft.rec.title} is overdue.`;
  });
}

function headlineFor(moves: Recommendation[], handled: MorningBrief["handled"]) {
  const sentences: string[] = [];
  if (moves.length === 0) sentences.push("Nothing stored needs you today.");
  else if (moves.length === 1) sentences.push(`Your highest-leverage move today is ${moves[0].action} for ${moves[0].business ?? "the stored business"}.`);
  else sentences.push(`Your highest-leverage moves today are ${humanList(moves.map((move) => `${move.action} for ${move.business ?? "the stored business"}`))}.`);
  if (handled.some((line) => /speed to lead/i.test(line.what))) {
    sentences.push("Speed to Lead has operational work underway, and none of it currently needs you.");
  }
  return sentences.slice(0, 3).join(" ");
}

function humanList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function factorsOf(row: WorkRow): Factors {
  return {
    financialImpact: row.financial_impact ?? 0,
    urgency: row.urgency ?? 0,
    strategicImportance: row.strategic_importance ?? 0,
    haydenDependency: row.hayden_dependency ?? 0,
    risk: row.risk ?? 0,
    timeCost: row.time_cost ?? 0,
  };
}

function label(value: string | null | undefined) {
  return value ? humanToken(value) : "unset";
}

function firstSentence(value: string | null | undefined) {
  if (!value) return "unset";
  const sentence = value.split(". ")[0]?.trim() ?? value;
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}

function daysBetween(older: string, today: string) {
  const start = Date.parse(`${older.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86400000);
}

export function staleAge(lastUpdated: string | null, today = brisbaneToday()) {
  if (!lastUpdated) return null;
  return daysBetween(lastUpdated, today);
}
