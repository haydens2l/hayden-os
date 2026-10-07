import { contextLabel, humanToken, isCurrentContext } from "../brain/labels";

export type BrainOrg = {
  id: string;
  name: string;
  description: string | null;
  strategic_role?: string | null;
  strategic_priority?: number | null;
  growth_intent?: string | null;
  hayden_role?: string | null;
  desired_hayden_involvement?: string | null;
  business_model?: string | null;
  primary_objective?: string | null;
  time_horizon?: string | null;
  data_status?: string | null;
  source_name?: string | null;
};

export type BrainKnowledge = {
  id: string;
  organisation_id: string | null;
  title: string;
  content: string;
  context_type?: string | null;
  superseded_by_id?: string | null;
  data_status?: string | null;
  source_name?: string | null;
  category?: string | null;
};

export type BrainPerson = {
  id: string;
  name: string;
  role: string | null;
  responsibilities: string | null;
  notes: string | null;
  organisation_id: string | null;
};

export type BrainQuestion = {
  id: string;
  question: string;
  why_it_matters: string | null;
  organisation_id: string | null;
  status: string;
};

export type BrainMetric = {
  organisation_id: string;
  metric_key: string;
  value: string;
  data_status?: string | null;
  label?: string | null;
};

export type BrainMemory = {
  organisations: BrainOrg[];
  knowledge: BrainKnowledge[];
  people: BrainPerson[];
  openQuestions: BrainQuestion[];
  metrics: BrainMetric[];
};

export type BrainItem = {
  title: string;
  detail: string;
  href?: string;
  source: string;
  kind?: string;
};

export type BrainAnswer = {
  heading: string;
  summary: string;
  items: BrainItem[];
};

const ORG_ALIASES: Array<{ id: string; names: string[] }> = [
  { id: "speed-to-lead", names: ["speed to lead"] },
  { id: "brisbane-collective", names: ["brisbane collective"] },
  { id: "property-made-simple", names: ["property made simple"] },
  { id: "media-empire", names: ["media empire"] },
  { id: "finance-engine", names: ["finance engine"] },
  { id: "inception", names: ["inception"] },
  { id: "wlth", names: ["wlth"] },
  { id: "fifo", names: ["fifo investor", "fifo"] },
];

export function answerFromBrain(query: string, memory: BrainMemory): BrainAnswer | null {
  const text = query.trim().toLowerCase();
  if (!text) return null;
  if (/unknown|open question|biggest gap|what don.?t we know|what are we missing/.test(text)) return unknowns(memory);
  if (/\bcpl\b|cost per lead|live figure|current revenue|how much .*earn|current (ad|ads|meta) /.test(text)) return figures(text, memory);
  if (/\bversus\b|\bvs\b|hayden do versus|compared with/.test(text)) return compare(text, memory);
  if (/\brole with\b|\bstrategy with\b|\bmy strategy\b/.test(text)) return personStrategy(text, memory) ?? orgStrategy(text, memory);
  if (/trying to become|trying to be|what is the strategy|strategy for|know about|what is my role|should hayden|founder doctrine|operating doctrine/.test(text)) {
    return personStrategy(text, memory) ?? orgStrategy(text, memory) ?? doctrine(memory);
  }
  return null;
}

function unknowns(memory: BrainMemory): BrainAnswer {
  const open = memory.openQuestions.filter((item) => item.status === "open");
  return {
    heading: "Open questions",
    summary: open.length
      ? `${open.length} open questions are stored. These are gaps. Nothing here was guessed.`
      : "No open questions are stored.",
    items: open.map((item) => ({
      title: "Unknown",
      detail: item.why_it_matters ? `${item.question} ${item.why_it_matters}` : item.question,
      href: "/intelligence/brain",
      source: provenance(item.id, "open question"),
      kind: "Unknown",
    })),
  };
}

function figures(text: string, memory: BrainMemory): BrainAnswer {
  const org = matchOrg(text, memory) ?? memory.organisations.find((item) => item.id === "inception");
  const live = memory.metrics.filter(
    (metric) =>
      (!org || metric.organisation_id === org.id) &&
      /cpl|revenue|spend/.test(metric.metric_key) &&
      metric.data_status === "live",
  );
  if (live.length === 0) {
    const subject = /\bcpl\b|cost per lead/.test(text) ? "CPL" : "figure";
    const name = org?.name ?? "that business";
    return {
      heading: `Current ${name} ${subject}`,
      summary: "No current live figure is stored.",
      items: [
        {
          title: "Unknown",
          detail: `No current ${subject} for ${name} is in memory. Live ad, CRM and finance connections are not on.`,
          href: org ? `/businesses/${org.id}` : "/intelligence/brain",
          source: "No live metric",
          kind: "Unknown",
        },
      ],
    };
  }
  return {
    heading: "Stored figures",
    summary: "These are marked live in memory.",
    items: live.map((metric) => ({
      title: metric.label ?? metric.metric_key,
      detail: metric.value,
      source: `${metric.data_status ?? "unlabelled"} metric`,
      kind: "Known fact",
    })),
  };
}

function compare(text: string, memory: BrainMemory): BrainAnswer {
  const lily = memory.people.find((person) => person.id === "lily");
  const haydenDoctrine = currentKnowledge(memory).filter((item) => item.category === "doctrine" || item.id === "know-lily");
  const items: BrainItem[] = haydenDoctrine.map(knowledgeItem);
  if (lily) {
    items.unshift({
      title: lily.name,
      detail: [lily.role, lily.responsibilities, lily.notes].filter(Boolean).join(" "),
      href: `/team/${lily.id}`,
      source: provenance(lily.id, "person"),
      kind: "Founder strategy",
    });
  }
  const other = memory.people.find((person) => person.id !== "hayden" && person.id !== "lily" && text.includes(person.name.toLowerCase()));
  if (other && !text.includes("lily")) {
    items.unshift({
      title: other.name,
      detail: [other.role, other.responsibilities, other.notes].filter(Boolean).join(" "),
      href: `/team/${other.id}`,
      source: provenance(other.id, "person"),
      kind: "Founder strategy",
    });
  }
  return {
    heading: "Who should do what",
    summary:
      "Hayden keeps strategic decisions and creative direction. Lily is for production execution from a finished brief. Routine production should go to Lily.",
    items,
  };
}

function personStrategy(text: string, memory: BrainMemory): BrainAnswer | null {
  const person = memory.people.find((item) => {
    const first = item.name.toLowerCase().split(" ")[0] ?? "";
    return first.length > 2 && new RegExp(`\\b${first}\\b`, "i").test(text);
  });
  if (!person || person.id === "hayden") return null;
  const notes = currentKnowledge(memory).filter(
    (item) => item.title.toLowerCase().includes(person.name.toLowerCase()) || item.content.toLowerCase().includes(person.name.toLowerCase()),
  );
  const historical = pastKnowledge(memory).filter((item) => item.content.toLowerCase().includes(person.name.toLowerCase()));
  const org = memory.organisations.find((item) => item.id === person.organisation_id);
  const inception = person.id === "drew" ? memory.organisations.find((item) => item.id === "inception") : undefined;
  return {
    heading: person.name,
    summary: [person.role, person.responsibilities, person.notes, org?.hayden_role, inception?.hayden_role].filter(Boolean).join(" "),
    items: [
      {
        title: person.name,
        detail: [person.role, person.responsibilities, person.notes].filter(Boolean).join(" "),
        href: `/team/${person.id}`,
        source: provenance(person.id, "person"),
        kind: "Founder strategy",
      },
      ...notes.map(knowledgeItem),
      ...historical.map(knowledgeItem),
    ],
  };
}

function orgStrategy(text: string, memory: BrainMemory): BrainAnswer | null {
  const org = matchOrg(text, memory);
  if (!org) return null;
  const current = currentKnowledge(memory).filter((item) => item.organisation_id === org.id);
  const historical = pastKnowledge(memory).filter((item) => item.organisation_id === org.id);
  const questions = memory.openQuestions.filter((item) => item.status === "open" && item.organisation_id === org.id);
  return {
    heading: org.name,
    summary: [
      `${org.name} is stored as ${humanToken(org.strategic_role)}.`,
      `Growth intent is ${humanToken(org.growth_intent)}.`,
      org.strategic_priority ? `Strategic priority ${org.strategic_priority} of 5.` : "",
      org.primary_objective ?? "",
      org.description ?? "",
      org.desired_hayden_involvement ?? "",
      historical.length ? "An older direction is still stored and is not the current strategy." : "",
    ]
      .filter(Boolean)
      .join(" "),
    items: [
      {
        title: "Founder strategy",
        detail: [org.description, org.hayden_role, org.business_model, org.time_horizon].filter(Boolean).join(" "),
        href: `/businesses/${org.id}`,
        source: provenance(org.id, "organisation"),
        kind: "Founder strategy",
      },
      ...current.map(knowledgeItem),
      ...historical.map(knowledgeItem),
      ...questions.map((item) => ({
        title: "Unknown",
        detail: item.question,
        href: "/intelligence/brain",
        source: provenance(item.id, "open question"),
        kind: "Unknown",
      })),
    ],
  };
}

function doctrine(memory: BrainMemory): BrainAnswer {
  const notes = currentKnowledge(memory).filter((item) => item.category === "doctrine");
  return {
    heading: "Operating doctrine",
    summary: "Founder strategy for how Hayden's time should be used. This is not a live performance report.",
    items: notes.map(knowledgeItem),
  };
}

function matchOrg(text: string, memory: BrainMemory) {
  const alias = ORG_ALIASES.find((item) => item.names.some((name) => text.includes(name)));
  if (!alias) return undefined;
  return memory.organisations.find((item) => item.id === alias.id);
}

function currentKnowledge(memory: BrainMemory) {
  return memory.knowledge.filter((item) => isCurrentContext(item));
}

function pastKnowledge(memory: BrainMemory) {
  return memory.knowledge.filter((item) => !isCurrentContext(item));
}

function knowledgeItem(item: BrainKnowledge): BrainItem {
  return {
    title: item.title,
    detail: item.content,
    href: "/intelligence/brain",
    source: provenance(item.id, "knowledge"),
    kind: contextLabel(item.context_type),
  };
}

function provenance(id: string, type: string) {
  return `Manual · Founder provided · ${type} ${id}`;
}
