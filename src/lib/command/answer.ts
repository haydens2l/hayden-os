import { answerFromBrain } from "@/lib/command/brain-answer";
import type { MemorySnapshot } from "@/lib/db/repository";
import type { TeamMember } from "@/lib/db/types";

export type CommandItem = {
  title: string;
  detail: string;
  href?: string;
  source: string;
  kind?: string;
};

export type CommandAnswer = {
  heading: string;
  summary: string;
  items: CommandItem[];
};

const STOP = new Set([
  "what",
  "whats",
  "that's",
  "this",
  "that",
  "with",
  "from",
  "have",
  "your",
  "should",
  "about",
  "today",
  "week",
  "does",
  "need",
  "them",
  "they",
  "their",
  "into",
  "over",
  "just",
  "been",
  "were",
  "when",
  "where",
  "which",
  "will",
  "would",
  "could",
  "there",
  "here",
  "doing",
  "working",
  "the",
  "and",
  "for",
  "are",
  "our",
  "how",
  "who",
]);

/**
 * Pulls only the memory slice that matches the question.
 * A model can replace the matcher later. It should still refuse to invent.
 */
export function answerQuestion(query: string, memory: MemorySnapshot): CommandAnswer | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const text = trimmed.toLowerCase();
  const person = mentionedPerson(text, memory.people);

  if (/who is overloaded|who hasn.?t completed|who has not completed/.test(text)) {
    return overloaded(memory);
  }
  if (/focus on|priorit|what should i|should i do/.test(text) && /today|morning|now/.test(text)) return focus(memory);
  const brain = answerFromBrain(trimmed, memory);
  if (brain) return brain;
  if (person && /waiting/.test(text)) return waitingOn(person, memory);
  if (person && /work|doing|task|priorit|overdue|overload/.test(text)) return personWork(person, memory);
  if (/decision|sitting on/.test(text) && !/did we decide|decide about/.test(text)) return openDecisions(memory);
  if (/did we decide|decide about|what did we/.test(text)) return pastDecisions(text, memory);
  if (/focus on|priorit|what should i|should i do/.test(text)) return focus(memory);
  if (/going wrong|problem|leak|money|broken/.test(text)) return problems(memory);
  if (/stop doing|should we stop/.test(text)) return stopDoing(memory);
  if (/perform|pulse|how are the business|how are we/.test(text)) return performance(memory);
  if (/what happened|this week|since monday|changed/.test(text)) return happened(memory);
  if (/advertis|content format|best performing|what.s working/.test(text)) return advertising(memory);
  if (person) return personWork(person, memory);

  return search(text, memory);
}

function mentionedPerson(query: string, people: TeamMember[]) {
  return people.find((person) => {
    const first = person.name.toLowerCase().split(" ")[0];
    return first.length > 2 && new RegExp(`\\b${first}\\b`, "i").test(query);
  });
}

function focus(memory: MemorySnapshot): CommandAnswer {
  const items = memory.attention.slice(0, 3).map((item) => ({
    title: item.title,
    detail:
      item.dataStatus === "demo"
        ? "Demo record. Not a live business fact."
        : [item.organisationName, item.why].filter(Boolean).join(" — "),
    href: item.entityType === "decision" ? `/decisions/${item.id}` : `/today/${item.id}`,
    source: `${item.entityType} ${item.id}`,
  }));
  return {
    heading: "What deserves you today",
    summary:
      items.length > 0
        ? `${items.length} item${items.length === 1 ? "" : "s"} need you this morning. The rest stays off this list.`
        : "Nothing needs you this morning.",
    items,
  };
}

function problems(memory: MemorySnapshot): CommandAnswer {
  const findings = memory.findings.filter((finding) => finding.category !== "content" && finding.category !== "team");
  const items = findings.map((finding) => ({
    title: finding.what_happened,
    detail: `${finding.why_it_matters} ${finding.recommended_response}`,
    href: finding.organisation_id ? `/businesses/${finding.organisation_id}` : "/intelligence",
    source: `finding ${finding.id}`,
  }));
  return {
    heading: "What is going wrong",
    summary: items.length ? "These are the stored problems. Nothing else was inferred." : "No open problems are stored.",
    items,
  };
}

function performance(memory: MemorySnapshot): CommandAnswer {
  const items = memory.organisations
    .filter((org) => org.interpretation && org.data_status !== "demo")
    .map((org) => ({
      title: org.name,
      detail: `${labelStatus(org.pulse_status)} — ${org.interpretation}`,
      href: `/businesses/${org.id}`,
      source: `organisation ${org.id}`,
    }));
  return {
    heading: "How the businesses look",
    summary: items.length ? "Status lines stored in memory. These are not a live ad account." : "No performance figures are stored.",
    items,
  };
}

function happened(memory: MemorySnapshot): CommandAnswer {
  return {
    heading: "What changed",
    summary: "The significant items stored in the briefing. Capped at five.",
    items: memory.findings.slice(0, 5).map((finding) => ({
      title: finding.what_happened,
      detail: finding.why_it_matters,
      href: "/intelligence",
      source: `finding ${finding.id}`,
    })),
  };
}

function openDecisions(memory: MemorySnapshot): CommandAnswer {
  const open = memory.decisions.filter((decision) => decision.status === "open");
  return {
    heading: "Decisions waiting on you",
    summary: open.length ? `${open.length} open. Ordinary tasks are not in this list.` : "No open decisions are stored.",
    items: open.map((decision) => ({
      title: decision.title,
      detail: decision.recommended_option ? `Stored recommendation: ${decision.recommended_option}` : decision.context ?? "",
      href: `/decisions/${decision.id}`,
      source: `decision ${decision.id}`,
    })),
  };
}

function pastDecisions(query: string, memory: MemorySnapshot): CommandAnswer {
  const decided = memory.decisions.filter((decision) => decision.status === "decided");
  const words = tokens(query);
  const matched = decided.filter((decision) => {
    const haystack = `${decision.title} ${decision.decision ?? ""} ${decision.organisation_name ?? ""}`.toLowerCase();
    return words.length === 0 || words.some((word) => haystack.includes(word));
  });
  const items = (matched.length ? matched : decided).map((decision) => ({
    title: decision.title,
    detail: decision.decision ?? "Decided, but the outcome text is empty.",
    href: `/decisions/${decision.id}`,
    source: `decision ${decision.id}`,
  }));
  return {
    heading: "What was decided",
    summary: items.length ? "Stored decisions only." : "No recorded decision matches that.",
    items,
  };
}

function waitingOn(person: TeamMember, memory: MemorySnapshot): CommandAnswer {
  const orgIds = new Set(familyIds(person.organisation_id, memory));
  const tasks = memory.priorities.filter((task) => task.organisation_id && orgIds.has(task.organisation_id));
  const decisions = memory.decisions.filter(
    (decision) => decision.status === "open" && decision.organisation_id && orgIds.has(decision.organisation_id),
  );
  const items: CommandItem[] = [
    ...decisions.map((decision) => ({
      title: decision.title,
      detail: decision.context ?? "",
      href: `/decisions/${decision.id}`,
      source: `decision ${decision.id}`,
    })),
    ...tasks.map((task) => ({
      title: task.title,
      detail: task.why_it_matters ?? "",
      href: `/today/${task.id}`,
      source: `task ${task.id}`,
    })),
  ];
  return {
    heading: `What ${person.name} is waiting on from you`,
    summary: items.length
      ? "Open decisions and items marked for you inside that part of the group."
      : `${person.name} does not have anything marked as waiting on you.`,
    items,
  };
}

function personWork(person: TeamMember, memory: MemorySnapshot): CommandAnswer {
  const tasks = memory.tasks.filter((task) => task.owner_id === person.id && task.status !== "done" && task.status !== "dismissed");
  return {
    heading: `${person.name}`,
    summary: `${person.role ?? "No role stored"}. ${person.open_tasks} open, ${person.overdue_tasks} overdue.`,
    items: tasks.map((task) => ({
      title: task.title,
      detail: [task.organisation_name, task.status === "open" && task.due_date ? `due ${task.due_date}` : task.status]
        .filter(Boolean)
        .join(" — "),
      href: `/team/${person.id}`,
      source: `task ${task.id}`,
    })),
  };
}

function overloaded(memory: MemorySnapshot): CommandAnswer {
  const people = memory.people.filter((person) => person.overdue_tasks > 0 || person.open_tasks >= 3);
  return {
    heading: "Load",
    summary: people.length ? "People with overdue work, or three or more open items." : "Nobody is stored as overloaded.",
    items: people.map((person) => ({
      title: person.name,
      detail: `${person.open_tasks} open, ${person.overdue_tasks} overdue. ${person.priorities.join("; ") || "No current priorities stored."}`,
      href: `/team/${person.id}`,
      source: `person ${person.id}`,
    })),
  };
}

function advertising(memory: MemorySnapshot): CommandAnswer {
  const top = memory.content[0];
  const items: CommandItem[] = memory.content.slice(0, 3).map((item) => ({
    title: item.hook || item.concept || "Untitled",
    detail: `${item.data_status === "demo" ? "Demo — not a live figure. " : ""}${item.brand ?? "Unknown brand"} · reach ${item.reach?.toLocaleString("en-AU") ?? "unknown"} · ${item.notes ?? ""}`,
    href: "/intelligence",
    source: `content ${item.id}`,
  }));
  if (top) {
    items.unshift({
      title: "Best stored reach",
      detail: `${top.brand ?? "Unknown"} · ${top.hook ?? top.concept} · ${top.notes ?? ""}`,
      href: "/intelligence",
      source: `content ${top.id}`,
    });
  }
  const weak = memory.campaigns.filter((campaign) => /do not scale|unapproved|higher cpl/i.test(campaign.notes ?? ""));
  weak.forEach((campaign) => {
    items.push({
      title: campaign.name,
      detail: campaign.notes ?? "No note stored.",
      href: `/businesses/${campaign.organisation_id}`,
      source: `campaign ${campaign.id}`,
    });
  });
  return {
    heading: "What the stored advertising says",
    summary: items.length
      ? "Ranked from content already in memory. No new performance was calculated."
      : "No performance figures are stored.",
    items,
  };
}

function stopDoing(memory: MemorySnapshot): CommandAnswer {
  const running = memory.experiments.filter((experiment) => experiment.status === "running");
  return {
    heading: "What not to stop blindly",
    summary: "Memory does not contain a shutdown order. These are the open experiments and the problems already flagged.",
    items: [
      ...running.map((experiment) => ({
        title: experiment.name,
        detail: experiment.learning ?? experiment.hypothesis ?? "",
        href: "/intelligence",
        source: `experiment ${experiment.id}`,
      })),
      ...memory.findings
        .filter((finding) => finding.requires_hayden === 1)
        .map((finding) => ({
          title: finding.what_happened,
          detail: finding.recommended_response,
          href: "/intelligence",
          source: `finding ${finding.id}`,
        })),
    ],
  };
}

function search(query: string, memory: MemorySnapshot): CommandAnswer {
  const words = tokens(query);
  if (words.length === 0) {
    return {
      heading: "Nothing to look up",
      summary: "Ask about a person, a business, a decision, or what needs you today.",
      items: [],
    };
  }

  type Hit = CommandItem & { score: number };
  const hits: Hit[] = [];
  const consider = (title: string, body: string, href: string, source: string) => {
    const haystack = `${title} ${body}`.toLowerCase();
    const score = words.reduce((total, word) => total + (haystack.includes(word) ? (title.toLowerCase().includes(word) ? 3 : 1) : 0), 0);
    if (score > 0) hits.push({ title, detail: body.slice(0, 220), href, source, score });
  };

  memory.knowledge.forEach((item) => {
    if (item.superseded_by_id || item.context_type === "HISTORICAL") return;
    consider(item.title, item.content, "/intelligence/brain", `knowledge ${item.id}`);
  });
  memory.projects.forEach((item) => consider(item.name, item.description ?? "", "/projects", `project ${item.id}`));
  memory.decisions.forEach((item) => consider(item.title, `${item.context ?? ""} ${item.decision ?? ""}`, `/decisions/${item.id}`, `decision ${item.id}`));
  memory.organisations.forEach((item) => consider(item.name, item.description ?? "", `/businesses/${item.id}`, `organisation ${item.id}`));
  memory.tasks.forEach((item) => consider(item.title, item.why_it_matters ?? "", `/today/${item.id}`, `task ${item.id}`));

  hits.sort((a, b) => b.score - a.score);
  const items = hits.slice(0, 5).map((hit) => ({
    title: hit.title,
    detail: hit.detail,
    href: hit.href,
    source: hit.source,
  }));
  return {
    heading: items.length ? "From business memory" : "Not in memory",
    summary: items.length
      ? "Matching records only. If it is not listed, it is not stored."
      : "Nothing stored matches that. I will not guess.",
    items,
  };
}

function tokens(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !STOP.has(word));
}

function familyIds(organisationId: string | null, memory: MemorySnapshot) {
  if (!organisationId) return [];
  const org = memory.organisations.find((item) => item.id === organisationId);
  const root = org?.parent_id ?? organisationId;
  return memory.organisations.filter((item) => item.id === root || item.parent_id === root).map((item) => item.id);
}

function labelStatus(status: string | null) {
  if (status === "action_required") return "Action required";
  if (status === "watch") return "Watch";
  if (status === "healthy") return "Healthy";
  return "No status";
}
