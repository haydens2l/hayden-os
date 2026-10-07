import type Database from "better-sqlite3";

const SOURCE = "Founder provided";

type OrgStrategy = {
  id: string;
  name: string;
  description: string;
  notes: string;
  strategicRole: string;
  strategicPriority: number;
  growthIntent: string;
  haydenRole: string;
  desiredHaydenInvolvement: string;
  businessModel: string;
  primaryObjective: string;
  timeHorizon: string;
};

type Note = {
  id: string;
  organisationId: string | null;
  category: string;
  title: string;
  content: string;
  contextType: string;
  confidence?: string;
};

type PersonUpdate = {
  id: string;
  organisationId: string;
  name: string;
  role: string;
  responsibilities: string;
  notes: string;
  managerId?: string | null;
};

export function applyStrategy(db: Database.Database) {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  for (const org of ORGANISATIONS) updateOrganisation(db, org, now);
  for (const person of PEOPLE) upsertPerson(db, person, now);
  for (const note of NOTES) upsertKnowledge(db, note, now, today);
  for (const question of QUESTIONS) upsertQuestion(db, question, now);
  for (const factor of FRAMEWORK) upsertFactor(db, factor);
}

function updateOrganisation(db: Database.Database, org: OrgStrategy, now: string) {
  db.prepare(
    `UPDATE organisations
     SET name = ?, description = ?, notes = ?,
         strategic_role = ?, strategic_priority = ?, growth_intent = ?, hayden_role = ?,
         desired_hayden_involvement = ?, business_model = ?, primary_objective = ?, time_horizon = ?,
         data_status = 'manual', source_type = 'hayden', source_name = ?, last_updated = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    org.name,
    org.description,
    org.notes,
    org.strategicRole,
    org.strategicPriority,
    org.growthIntent,
    org.haydenRole,
    org.desiredHaydenInvolvement,
    org.businessModel,
    org.primaryObjective,
    org.timeHorizon,
    SOURCE,
    now,
    now,
    org.id,
  );
}

function upsertPerson(db: Database.Database, person: PersonUpdate, now: string) {
  db.prepare(
    `INSERT INTO people (
      id, organisation_id, name, role, responsibilities, manager_id, contact_information, status, notes,
      created_at, updated_at, data_status, source_type, source_name, last_updated
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?, 'manual', 'hayden', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      organisation_id = excluded.organisation_id,
      name = excluded.name,
      role = excluded.role,
      responsibilities = excluded.responsibilities,
      notes = excluded.notes,
      data_status = 'manual',
      source_type = 'hayden',
      source_name = excluded.source_name,
      last_updated = excluded.last_updated,
      updated_at = excluded.updated_at`,
  ).run(
    person.id,
    person.organisationId,
    person.name,
    person.role,
    person.responsibilities,
    person.managerId ?? null,
    person.notes,
    now,
    now,
    SOURCE,
    now,
  );
}

function upsertKnowledge(db: Database.Database, note: Note, now: string, today: string) {
  db.prepare(
    `INSERT INTO knowledge (
      id, organisation_id, category, title, content, source, confidence, last_verified, created_at, updated_at,
      data_status, source_type, source_name, last_updated, context_type, effective_from
    ) VALUES (?, ?, ?, ?, ?, 'Hayden', ?, ?, ?, ?, 'manual', 'hayden', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      organisation_id = excluded.organisation_id,
      category = excluded.category,
      title = excluded.title,
      content = excluded.content,
      confidence = excluded.confidence,
      last_verified = excluded.last_verified,
      data_status = 'manual',
      source_type = 'hayden',
      source_name = excluded.source_name,
      last_updated = excluded.last_updated,
      context_type = excluded.context_type,
      effective_from = COALESCE(knowledge.effective_from, excluded.effective_from),
      updated_at = excluded.updated_at
    WHERE knowledge.superseded_by_id IS NULL`,
  ).run(
    note.id,
    note.organisationId,
    note.category,
    note.title,
    note.content,
    note.confidence ?? "high",
    today,
    now,
    now,
    SOURCE,
    now,
    note.contextType,
    today,
  );
}

function upsertQuestion(
  db: Database.Database,
  question: { id: string; organisationId: string | null; question: string; why: string },
  now: string,
) {
  db.prepare(
    `INSERT INTO open_questions (
      id, organisation_id, question, why_it_matters, status, data_status, source_type, source_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'open', 'manual', 'hayden', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      question = excluded.question,
      why_it_matters = excluded.why_it_matters,
      organisation_id = excluded.organisation_id,
      data_status = 'manual',
      source_name = excluded.source_name,
      updated_at = excluded.updated_at
    WHERE open_questions.status = 'open'`,
  ).run(question.id, question.organisationId, question.question, question.why, SOURCE, now, now);
}

function upsertFactor(db: Database.Database, factor: { id: string; key: string; label: string; guidance: string; sort: number }) {
  db.prepare(
    `INSERT INTO opportunity_framework (id, factor_key, label, guidance, sort_order)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(factor_key) DO UPDATE SET label = excluded.label, guidance = excluded.guidance, sort_order = excluded.sort_order`,
  ).run(factor.id, factor.key, factor.label, factor.guidance, factor.sort);
}

const ORGANISATIONS: OrgStrategy[] = [
  {
    id: "finance-engine",
    name: "Finance Engine",
    description: "Operating group for Hayden's commercial relationship with Drew and the finance and property ecosystem. Inception, WLTH and FIFO Investor sit inside it.",
    notes: "Founder-provided operating group. Legal ownership is not stored. No live performance figures are connected.",
    strategicRole: "PARTNERSHIP",
    strategicPriority: 5,
    growthIntent: "GROW",
    haydenRole: "Commercial relationship with Drew, plus marketing, sales and growth strategy across the finance brands.",
    desiredHaydenInvolvement: "Strategy and commercial judgement with Drew. Routine fulfilment stays off Hayden.",
    businessModel: "Partnership and commercial relationship. The legal structure is not stored.",
    primaryObjective: "Grow the finance and property engine through Hayden's commercial relationship with Drew, without Hayden doing routine delivery.",
    timeHorizon: "No dated horizon is stored.",
  },
  {
    id: "inception",
    name: "Inception Wealth Group",
    description: "Core growth brand inside the Finance Engine. The acquisition path Hayden is building is lead, Sim, shown Sim, strategist appointment, sale.",
    notes: "Founder-provided strategy. No current performance for Drew, Michael or Pete is stored.",
    strategicRole: "CORE_GROWTH / PARTNERSHIP",
    strategicPriority: 5,
    growthIntent: "GROW",
    haydenRole: "Marketing, sales, growth and commercial strategy. Also sales process, training, coaching, performance, lead generation and conversion improvement.",
    desiredHaydenInvolvement: "Management and strategy. Hayden should move off personally doing routine operational work.",
    businessModel: "Acquisition into appointments and sales. Compensation context is stored separately and is not a forecast.",
    primaryObjective: "Build a predictable acquisition, appointment, strategist and sale engine.",
    timeHorizon: "No dated horizon is stored.",
  },
  {
    id: "wlth",
    name: "WLTH",
    description: "Partnership and growth brand. Offer categories can include profession lending conversations, SMSF commercial property, and accountant-channel opportunities.",
    notes: "Lending, LMI, tax, investment and property outcomes are never guaranteed.",
    strategicRole: "PARTNERSHIP / CORE_GROWTH",
    strategicPriority: 4,
    growthIntent: "GROW",
    haydenRole: "Marketing and sales strategy.",
    desiredHaydenInvolvement: "Campaign and offer direction. Not routine fulfilment.",
    businessModel: "Marketing and sales partnership across lending and property-finance conversations.",
    primaryObjective: "Grow WLTH through marketing and sales strategy, including profession, SMSF commercial and accountant-channel categories where relevant.",
    timeHorizon: "No dated horizon is stored.",
  },
  {
    id: "fifo",
    name: "FIFO Investor",
    description: "Brand and acquisition asset for Australian FIFO workers, inside the finance and property ecosystem until Hayden changes that.",
    notes: "Operating treatment, not a confirmed legal structure. No live performance is stored.",
    strategicRole: "MEDIA_ASSET / LEAD_GENERATION",
    strategicPriority: 3,
    growthIntent: "OPTIMISE",
    haydenRole: "Brand and acquisition direction.",
    desiredHaydenInvolvement: "Message and acquisition direction. Not routine production.",
    businessModel: "Attention and qualified opportunities through content and advertising.",
    primaryObjective: "Generate attention and qualified opportunities from Australian FIFO workers through relevant content and advertising.",
    timeHorizon: "No dated horizon is stored.",
  },
  {
    id: "media-empire",
    name: "Media Empire",
    description: "Long-term direction toward owned attention, audiences, content IP and distribution. This is not another client-service operation.",
    notes: "Founder-provided strategy. No revenue or monetisation model is selected yet.",
    strategicRole: "MEDIA_ASSET",
    strategicPriority: 5,
    growthIntent: "AGGRESSIVE_GROWTH",
    haydenRole: "Idea quality, creative direction and commercial strategy.",
    desiredHaydenInvolvement: "Direction and commercial calls. Production steps should become a system.",
    businessModel: "Owned media that can later monetise through leads, partnerships, sponsorship, referrals, owned products and other opportunities. No model is selected yet.",
    primaryObjective: "Build owned attention, audiences, content IP and distribution.",
    timeHorizon: "Long-term direction. No dated finish line is stored.",
  },
  {
    id: "brisbane-collective",
    name: "Brisbane Collective",
    description: "Brisbane-focused media and community brand. People. Places. Possibilities. Audience-first, not a property sales page.",
    notes: "The brand is not primarily about selling Brisbane investment properties. No monetisation model is selected yet.",
    strategicRole: "MEDIA_ASSET",
    strategicPriority: 5,
    growthIntent: "AGGRESSIVE_GROWTH",
    haydenRole: "Creative direction and commercial strategy for an owned media brand.",
    desiredHaydenInvolvement: "Positioning, creative direction and partnership judgement.",
    businessModel: "Owned attention. Commercial paths can include leads, referrals, local partnerships, sponsorship, distribution and B2B. None is selected yet.",
    primaryObjective: "Build a Brisbane audience around people, places and possibilities, then connect that attention with relevant experts where it genuinely helps.",
    timeHorizon: "Long-term brand. No dated finish line is stored.",
  },
  {
    id: "property-made-simple",
    name: "Property Made Simple",
    description: "Entertaining property and finance content. Entertainment first. Investing, property and finance, not rent-focused content.",
    notes: "Avoid personalised financial advice. No monetisation model is selected yet. No performance figures are stored.",
    strategicRole: "MEDIA_ASSET / LEAD_GENERATION",
    strategicPriority: 5,
    growthIntent: "AGGRESSIVE_GROWTH",
    haydenRole: "Idea quality, creative direction and commercial strategy.",
    desiredHaydenInvolvement: "Creative standard and commercial use of the attention. Not every production step.",
    businessModel: "Attention that can become commercial opportunity. The monetisation model is not selected.",
    primaryObjective: "Create entertaining property and finance content that generates attention and, later, commercial opportunities.",
    timeHorizon: "Long-term brand. No dated finish line is stored.",
  },
  {
    id: "speed-to-lead",
    name: "Speed to Lead",
    description: "Cash-flow and service operation. Operational volume does not make it a strategic growth priority.",
    notes: "Hayden is intentionally reducing client load and moving away from heavy onboarding and service complexity. No current revenue or client count is stored.",
    strategicRole: "CASH_FLOW / SERVICE",
    strategicPriority: 2,
    growthIntent: "REDUCE / OPTIMISE",
    haydenRole: "Only meaningful commercial, financial, personnel or strategic matters.",
    desiredHaydenInvolvement: "Minimal. Question anything that reaches Hayden: can AP, Nic, another person, or automation handle it?",
    businessModel: "Remaining client service, run to stay profitable and low-touch.",
    primaryObjective: "Maintain profitable remaining operations with minimal Hayden involvement.",
    timeHorizon: "Current direction is to reduce founder load. No dated finish line is stored.",
  },
];

const PEOPLE: PersonUpdate[] = [
  {
    id: "hayden",
    organisationId: "finance-engine",
    name: "Hayden Pawelski",
    role: "Founder",
    responsibilities: "Strategy, creative direction, distribution, relationships, capital allocation, new ventures, offers, and high-value commercial decisions.",
    notes: "Time should move away from admin, CRM cleanup, routine client service, manual reporting, chasing, routine production, data entry and low-value fulfilment.",
    managerId: null,
  },
  {
    id: "drew",
    organisationId: "finance-engine",
    name: "Drew",
    role: "Finance engine lead",
    responsibilities: "Key person in the Finance Engine and the Inception relationship.",
    notes: "Named by Hayden. No current performance is stored.",
    managerId: "hayden",
  },
  {
    id: "michael",
    organisationId: "inception",
    name: "Michael",
    role: "Inception",
    responsibilities: "Named by Hayden as part of the Inception engine.",
    notes: "No job detail beyond that, and no performance, is stored.",
  },
  {
    id: "pete",
    organisationId: "inception",
    name: "Pete",
    role: "Inception",
    responsibilities: "Named by Hayden as part of the Inception engine.",
    notes: "No job detail beyond that, and no performance, is stored.",
  },
  {
    id: "lily",
    organisationId: "media-empire",
    name: "Lily",
    role: "Execution, content and advertising support",
    responsibilities: "Production and advertising execution from production-ready instructions.",
    notes: "Delegate suitable production to Lily. Hayden should not walk every execution step. No current workload figure is stored.",
    managerId: "hayden",
  },
  {
    id: "danny",
    organisationId: "media-empire",
    name: "Danny",
    role: "AI-video fulfilment",
    responsibilities: "Paid AI-video fulfilment during the initial working period.",
    notes: "Desired trajectory is creative director and creative strategist inside the media operation. That move has not happened. It depends on performance, which is not stored.",
  },
  {
    id: "ap",
    organisationId: "speed-to-lead",
    name: "AP",
    role: "Operations, systems and data",
    responsibilities: "Operational systems, CRM hygiene, data integrity, reporting infrastructure, process documentation, automation support, and repeatable admin.",
    notes: "As Speed to Lead onboarding reduces, route suitable operational work to AP rather than Hayden. No current workload is stored.",
  },
  {
    id: "nic",
    organisationId: "speed-to-lead",
    name: "Nic",
    role: "Team coaching and setter performance",
    responsibilities: "Setter performance, team coaching and KPI oversight where that applies.",
    notes: "Route routine setter performance and coaching to Nic before Hayden. No current KPI result is stored.",
  },
];

const NOTES: Note[] = [
  {
    id: "know-direction",
    organisationId: null,
    category: "doctrine",
    contextType: "STRATEGY",
    title: "Where Hayden is heading",
    content:
      "Hayden is deliberately moving away from heavy client fulfilment and day-to-day service delivery. The direction is owned media, owned audiences, distribution, intellectual property, scalable lead generation, creative strategy, AI-assisted content production, partnerships, high-leverage commercial relationships, equity or ownership-style upside where appropriate, and systems that run without Hayden doing routine fulfilment.",
  },
  {
    id: "know-time",
    organisationId: null,
    category: "doctrine",
    contextType: "STRATEGY",
    title: "Where Hayden's time should go",
    content:
      "Hayden's time should move toward strategy, creative direction, distribution, relationships, capital allocation, new ventures, offers and high-value commercial decisions. It should move away from admin, CRM cleanup, routine client service, manual reporting, chasing people, routine production, data entry and low-value fulfilment.",
  },
  {
    id: "know-do",
    organisationId: null,
    category: "doctrine",
    contextType: "STRATEGY",
    title: "What Hayden should do",
    content:
      "Strategic decisions, creative direction, offer creation, major campaign direction, capital allocation, hiring and firing, high-value partnerships, important Drew conversations, media strategy, new business models, major positioning, and commercial negotiation.",
  },
  {
    id: "know-delegate",
    organisationId: null,
    category: "doctrine",
    contextType: "STRATEGY",
    title: "What Hayden should delegate",
    content:
      "Routine CRM work, setter coaching, data cleanup, routine reports, content production execution, basic creative resizing, file organisation, lead chasing, standard confirmations, routine follow-up, administrative research and process documentation.",
  },
  {
    id: "know-protect",
    organisationId: null,
    category: "doctrine",
    contextType: "PREFERENCE",
    title: "What Hayden OS should protect against",
    content:
      "Hayden becoming the bottleneck. Too many client-service tasks. Low-value operational work. Constant context switching. Shiny-object projects without strategic value. Projects without owners. Projects without monetisation or a strategic purpose. Tasks disguised as decisions. Problems escalated before the owner has tried to solve them.",
  },
  {
    id: "know-attention",
    organisationId: null,
    category: "doctrine",
    contextType: "STRATEGY",
    title: "What Hayden is for",
    content:
      "Hayden is for direction, major creative decisions, relationships, capital, hiring, commercial calls, partnerships, new ventures and offer direction. He is not the route for CRM cleanup, chasing, formatting, routine production, reminders or data entry.",
  },
  {
    id: "know-inception",
    organisationId: "inception",
    category: "positioning",
    contextType: "STRATEGY",
    title: "Inception mortgage-free date",
    content:
      "Inception ads should open on the mortgage-free date, not on refinancing or an investment property. This is positioning guidance, not a measured result.",
  },
  {
    id: "know-inception-engine",
    organisationId: "inception",
    category: "operating",
    contextType: "STRATEGY",
    title: "Inception operating concepts",
    content:
      "The engine Hayden wants is acquisition, then appointment, then strategist, then sale. The working concepts are lead, Sim, shown Sim, strategist appointment and sale. Current volumes are not stored.",
  },
  {
    id: "know-inception-pay",
    organisationId: "inception",
    category: "economics",
    contextType: "FACT",
    title: "Inception compensation arrangement",
    content:
      "Hayden has an agreed arrangement of $1,500 per week base plus $400 per shown qualified appointment under the agreed structure. This is the stored arrangement. It is not guaranteed future income, and no current payment total is stored.",
  },
  {
    id: "know-inception-layer",
    organisationId: "inception",
    category: "strategy",
    contextType: "STRATEGY",
    title: "Inception management layer",
    content:
      "Hayden should gradually operate at the management and strategy layer rather than personally performing routine operational work. Drew, Michael and Pete are the named people. Their current performance is not stored.",
  },
  {
    id: "know-wlth",
    organisationId: "wlth",
    category: "positioning",
    contextType: "PREFERENCE",
    title: "WLTH claim boundary",
    content:
      "WLTH can ask whether a profession might open a higher-LVR conversation, and campaign categories can include 95% LVR / no LMI profession campaigns, SMSF commercial property campaigns and accountant-channel opportunities. Never imply everyone qualifies. Never guarantee 95% LVR, no LMI, tax outcomes, investment results or property outcomes.",
  },
  {
    id: "know-fifo",
    organisationId: "fifo",
    category: "positioning",
    contextType: "STRATEGY",
    title: "FIFO message",
    content:
      "FIFO Investor speaks to Australian FIFO workers. The emotional goal is a path toward not needing FIFO. Do not promise tax savings. Do not attack property. The brand is an acquisition asset, not a confirmed statement of legal ownership.",
  },
  {
    id: "know-fifo-assumption",
    organisationId: "fifo",
    category: "strategy",
    contextType: "ASSUMPTION",
    title: "FIFO placement",
    content:
      "FIFO Investor is treated as a brand and acquisition asset inside the finance and property ecosystem until Hayden manually changes that. This is an operating assumption, not a stored legal fact.",
  },
  {
    id: "know-media-objective",
    organisationId: "media-empire",
    category: "strategy",
    contextType: "STRATEGY",
    title: "Media Empire objective",
    content:
      "Build owned attention, audiences, content IP and distribution that can later monetise through lead generation, partnerships, sponsorships, referral economics, owned products and other opportunities. It is not another client-service operation. No monetisation model is selected yet.",
  },
  {
    id: "know-production",
    organisationId: "media-empire",
    category: "operating",
    contextType: "STRATEGY",
    title: "Media production model",
    content:
      "AI content production should become a system: idea, creative direction, script, storyboard, start and end frames, video prompts, generation, edit, distribution, performance data, learning, next iteration. Hayden should own idea quality, creative direction and commercial strategy rather than every production step.",
  },
  {
    id: "know-brisbane",
    organisationId: "brisbane-collective",
    category: "positioning",
    contextType: "STRATEGY",
    title: "What Brisbane Collective is trying to become",
    content:
      "A Brisbane-focused media and community brand: People. Places. Possibilities. Content can include street interviews, local conversations, finance and property-adjacent conversations, Brisbane culture and highly shareable local content. The brand is not primarily about selling Brisbane investment properties. The commercial layer can later connect the audience with relevant experts around tax where it is legitimate, paying a mortgage off faster, building wealth, property strategy, finance, replacing income and professional services. It should feel audience-first. Long-term paths can include leads, referral partnerships, local partnerships, sponsorship, distribution, B2B and owned-media monetisation. None of those is selected yet.",
  },
  {
    id: "know-pms",
    organisationId: "property-made-simple",
    category: "positioning",
    contextType: "STRATEGY",
    title: "Property Made Simple creative principle",
    content:
      "Entertainment first. Educational or financial ideas should usually sit inside comedy, story, tension, surprise, characters, visual metaphor, comparison or social observation. Territory includes property stories, numbers, Australian property culture, mortgages, tax, wealth, everyday Australians, humorous characters and comparisons. The content is about investing, property and finance, not rent. Avoid a dry finance page and avoid personalised financial advice.",
  },
  {
    id: "know-danny",
    organisationId: "media-empire",
    category: "people",
    contextType: "STRATEGY",
    title: "Strategy with Danny",
    content:
      "Danny's current relationship can include paid AI-video fulfilment during the initial working period. The long-term intent is a higher-leverage creative direction and strategy role if performance justifies it. That transition has not happened, and no performance case is stored.",
  },
  {
    id: "know-danny-hypothesis",
    organisationId: "media-empire",
    category: "people",
    contextType: "HYPOTHESIS",
    title: "Danny role hypothesis",
    content:
      "If the work justifies it, Danny can move from being valued per piece of fulfilment toward creative direction. This is a hypothesis, not a decision.",
  },
  {
    id: "know-lily",
    organisationId: "media-empire",
    category: "people",
    contextType: "STRATEGY",
    title: "How to use Lily",
    content:
      "Lily is execution, content and advertising support. She should get production-ready instructions. Suitable production work should be delegated to Lily rather than escalated to Hayden.",
  },
  {
    id: "know-stl",
    organisationId: "speed-to-lead",
    category: "strategy",
    contextType: "STRATEGY",
    title: "Speed to Lead direction",
    content:
      "Speed to Lead is a cash-flow and service operation being reduced and optimised for low Hayden involvement. More tasks do not make it strategically important. Keep remaining work profitable, systemised, delegated and low-touch. Before anything reaches Hayden, ask whether AP, Nic, another person or automation can handle it, and whether the client or task justifies founder attention. Only commercial, financial, personnel or strategic matters should escalate.",
  },
  {
    id: "know-ownership",
    organisationId: "finance-engine",
    category: "strategy",
    contextType: "ASSUMPTION",
    title: "Finance Engine is an operating group",
    content:
      "Finance Engine is an operating grouping for Hayden OS. It is not a stored statement of legal ownership.",
  },
  {
    id: "know-opportunity-rule",
    organisationId: null,
    category: "framework",
    contextType: "PREFERENCE",
    title: "Opportunity evaluation does not decide",
    content:
      "A new idea can be scored later on strategic alignment, revenue potential, media and distribution leverage, scalability, founder dependency, complexity, speed to validation, capital requirement, synergy with existing assets, and Hayden's conviction. Each factor is 0 to 5. The analysis is stored so Hayden can decide. The system does not choose for him.",
  },
];

const QUESTIONS: Array<{ id: string; organisationId: string | null; question: string; why: string }> = [
  {
    id: "q-revenue",
    organisationId: null,
    question: "No current revenue figure is stored for any organisation.",
    why: "Strategy can say what matters. It cannot say what the businesses currently earn.",
  },
  {
    id: "q-meta",
    organisationId: null,
    question: "No live Meta connection is on, so no current advertising figures are stored.",
    why: "Campaign judgements need a source. None is connected.",
  },
  {
    id: "q-inception-cpl",
    organisationId: "inception",
    question: "No current Inception CPL is stored.",
    why: "Acquisition cost is unknown until a live or manually entered figure exists.",
  },
  {
    id: "q-inception-people",
    organisationId: "inception",
    question: "No current performance is stored for Drew, Michael or Pete.",
    why: "They are named. Their results are not.",
  },
  {
    id: "q-ownership",
    organisationId: "finance-engine",
    question: "No legal ownership structure is stored for the Finance Engine.",
    why: "The group is an operating view only.",
  },
  {
    id: "q-brisbane-model",
    organisationId: "brisbane-collective",
    question: "No monetisation model is selected yet for Brisbane Collective.",
    why: "Possible paths are listed. None has been chosen.",
  },
  {
    id: "q-pms-model",
    organisationId: "property-made-simple",
    question: "No monetisation model is selected yet for Property Made Simple.",
    why: "Attention is the purpose so far. The commercial model is open.",
  },
  {
    id: "q-danny",
    organisationId: "media-empire",
    question: "Danny's move from AI-video fulfilment into creative direction is not confirmed.",
    why: "The trajectory is stored. The transition is not.",
  },
  {
    id: "q-stl-numbers",
    organisationId: "speed-to-lead",
    question: "No current Speed to Lead revenue or client count is stored.",
    why: "The direction is to reduce founder load. The size of what remains is unknown.",
  },
  {
    id: "q-deadlines",
    organisationId: null,
    question: "No dated strategic deadlines are stored.",
    why: "Horizons in the strategy are qualitative. A date would be an invention.",
  },
];

const FRAMEWORK: Array<{ id: string; key: string; label: string; guidance: string; sort: number }> = [
  ["alignment", "Strategic alignment", "Does this move Hayden toward owned media, distribution, relationships and leverage?"],
  ["revenue", "Revenue potential", "Could it earn. No figure is assumed."],
  ["media", "Media and distribution leverage", "Does it use or build an audience Hayden owns?"],
  ["scale", "Scalability", "Can it grow without Hayden doing the fulfilment?"],
  ["dependency", "Founder dependency", "How much of Hayden does it need? Higher means more of his time."],
  ["complexity", "Complexity", "How much new operating load does it add?"],
  ["validation", "Speed to validation", "How quickly can Hayden learn if it is real?"],
  ["capital", "Capital requirement", "What funding does it need? Nothing is assumed."],
  ["synergy", "Synergy with existing assets", "Does it use the finance engine, the media brands, or the people already here?"],
  ["conviction", "Hayden excitement and conviction", "Hayden's own pull toward it. Stored, not decided."],
].map(([key, label, guidance], index) => ({
  id: `factor-${key}`,
  key,
  label,
  guidance,
  sort: index + 1,
}));
