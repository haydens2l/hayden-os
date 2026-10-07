import type Database from "better-sqlite3";
import type { CommandAnswer } from "@/lib/command/answer";
import { buildMorningBrief } from "@/lib/chief/reason";
import { retrieveContext } from "@/lib/chief/retrieve";

export function isChiefQuestion(query: string) {
  const text = query.toLowerCase();
  if (/meta|facebook ads|instagram ads/.test(text) && /perform|yesterday|result|how (are|did|is)|doing/.test(text)) return true;
  if (/what should i focus|where should i focus|what do i focus/.test(text)) return true;
  if (/wasting time|waste my time|waste time/.test(text)) return true;
  if (/what'?s stuck|what is stuck|where are we stuck/.test(text)) return true;
  if (/who needs something from me|who needs me|needs something from me/.test(text)) return true;
  if (/what can i delegate|what should i delegate/.test(text)) return true;
  if (/media empire/.test(text)) return true;
  if (/biggest opportunity/.test(text)) return true;
  if (/been ignoring|what have i ignored|what am i ignoring/.test(text)) return true;
  if (/changed since yesterday|since yesterday/.test(text)) return true;
  if (/bottleneck/.test(text)) return true;
  return false;
}

export function answerAsChief(db: Database.Database, query: string): CommandAnswer {
  const text = query.toLowerCase();
  if (/meta|facebook ads|instagram ads/.test(text) && /perform|yesterday|result|how (are|did|is)|doing/.test(text)) {
    return metaAnswer(db);
  }

  const brief = buildMorningBrief(db);
  const context = retrieveContext(db);

  if (/bottleneck/.test(text)) {
    return {
      heading: "Founder bottlenecks",
      summary: brief.bottlenecks[0] ?? "No stored pattern shows you as the bottleneck.",
      items: brief.bottlenecks.slice(1).map((line) => ({
        title: "Stored pattern",
        detail: line,
        source: "projects",
        kind: "Fact",
      })),
    };
  }

  if (/meta|facebook|instagram/.test(text)) return metaAnswer(db);

  if (/wasting time|waste my time|waste time|been ignoring|what have i ignored|what am i ignoring/.test(text)) {
    return {
      heading: "What I would ignore",
      summary: brief.ignore[0]?.what ?? "No operational cluster is stored as noise.",
      items: brief.ignore.map((line) => ({
        title: line.what,
        detail: line.why,
        source: line.id,
        kind: "Recommendation",
      })),
    };
  }

  if (/what'?s stuck|what is stuck|where are we stuck/.test(text)) {
    const stuck = context.projects.filter((project) => project.status === "blocked" || project.status === "waiting");
    const visual = db
      .prepare(`SELECT summary FROM agent_notices WHERE requires_hayden = 1 AND summary LIKE '%storyboard%' ORDER BY created_at DESC LIMIT 3`)
      .all() as Array<{ summary: string }>;
    const creative = db.prepare(`SELECT brand, title, stage FROM content_items WHERE stage IN ('CONCEPT_REVIEW', 'SCRIPT_REVIEW', 'STYLE_SELECTION', 'STORYBOARD_REVIEW') ORDER BY updated_at DESC LIMIT 6`).all() as Array<{ brand: string | null; title: string | null; stage: string }>;
    return {
      heading: "What is stuck",
      summary: stuck.length === 0 && visual.length === 0 && creative.length === 0 ? "Nothing creative needs you right now." : "Creative decisions and stored blockers.",
      items: [
        ...creative.map((item) => ({ title: `${item.brand ?? "Content"} — ${item.title ?? "Untitled"}`, detail: item.stage.replaceAll("_", " "), source: "content_items", kind: "Fact" })),
        ...visual.map((item) => ({ title: "Visual QA", detail: item.summary, source: "agent_notices", kind: "Fact" })),
        ...stuck.map((project) => ({
          title: project.name,
          detail: `${project.organisation_name ?? "No business"}. Status: ${project.status}.${project.blocked_by ? ` Blocked by ${project.blocked_by}.` : ""}`,
          source: `project ${project.id}`,
          kind: "Fact",
        })),
      ],
    };
  }

  if (/what can i delegate|what should i delegate/.test(text)) {
    const items = brief.recommendations.filter((item) => item.recommendedClassification === "delegate" && item.recommendedOwnerName);
    return {
      heading: "What can be delegated",
      summary: items.length === 0 ? "Nothing stored is a delegation recommendation." : `${items.length} item${items.length === 1 ? "" : "s"} should sit with someone else.`,
      items: items.slice(0, 8).map((item) => ({
        title: item.title,
        detail: `${item.recommendedOwnerName}. ${item.ownerReason ?? ""} Expected: ${item.expectedOutcome}`,
        source: `${item.entityType} ${item.id}`,
        kind: "Recommendation",
      })),
    };
  }

  if (/who needs something from me|who needs me|needs something from me/.test(text)) {
    return {
      heading: "Who needs you",
      summary: brief.moves.length === 0 ? "Nobody stored is waiting on a founder move." : brief.headline,
      items: brief.moves.map((move) => ({
        title: move.action,
        detail: `${move.business ?? "No business"}. ${move.why}`,
        source: `${move.entityType} ${move.id}`,
        kind: "Fact",
      })),
    };
  }

  if (/biggest opportunity/.test(text)) {
    const top = brief.opportunities[0];
    return {
      heading: "Biggest stored opportunity",
      summary: top ? top.title : "No meaningful opportunity is stored.",
      items: top
        ? [
            { title: top.business ?? "No business", detail: top.why, source: `opportunity ${top.id}`, kind: "Fact" },
            { title: "Recommendation", detail: top.nextStep, source: `opportunity ${top.id}`, kind: "Recommendation" },
          ]
        : [{ title: "Unknown", detail: "No open opportunity record is stored.", source: "opportunities", kind: "Unknown" }],
    };
  }

  if (/changed since yesterday|since yesterday/.test(text)) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fresh = brief.recommendations.filter((item) => {
      const draft = context.tasks.find((row) => row.id === item.id) ?? context.decisions.find((row) => row.id === item.id) ?? context.opportunities.find((row) => row.id === item.id);
      return draft ? draft.created_at > since : false;
    });
    return {
      heading: "Since yesterday",
      summary: fresh.length === 0 ? "No meaningful change is stored since yesterday." : `${fresh.length} meaningful record${fresh.length === 1 ? "" : "s"} appeared in the last day.`,
      items: fresh.map((item) => ({
        title: item.title,
        detail: item.why,
        source: `${item.entityType} ${item.id}`,
        kind: "Fact",
      })),
    };
  }

  if (/media empire/.test(text)) {
    const org = context.organisations.find((item) => item.id === "media-empire");
    const children = context.organisations.filter((item) => item.parent_id === "media-empire");
    const work = brief.recommendations.filter((item) => item.organisationId === "media-empire" || children.some((child) => child.id === item.organisationId));
    return {
      heading: "Media empire",
      summary: org ? `${org.name} is stored at strategic priority ${org.strategic_priority ?? "unset"} with growth intent ${org.growth_intent ?? "unset"}.` : "No media empire record is stored.",
      items: [
        {
          title: "Stored strategy",
          detail: org ? `Role ${org.strategic_role ?? "unset"}. Hayden's role: ${org.hayden_role ?? "unset"}. Involvement: ${org.desired_hayden_involvement ?? "unset"}.` : "No strategy row is stored.",
          source: "organisation media-empire",
          kind: "Fact",
        },
        {
          title: "Live performance",
          detail: "No live performance data is connected for the media empire.",
          source: "metrics",
          kind: "Unknown",
        },
        ...work.slice(0, 4).map((item) => ({
          title: item.title,
          detail: item.why,
          source: `${item.entityType} ${item.id}`,
          kind: item.recommendedClassification === "hayden_now" ? "Recommendation" : "Interpretation",
        })),
      ],
    };
  }

  return {
    heading: "What deserves you",
    summary: brief.headline,
    items: [
      ...brief.moves.map((move) => ({
        title: move.action,
        detail: `${move.business ?? "No business"}. ${move.why} Next: ${move.nextStep}`,
        source: `${move.entityType} ${move.id}`,
        kind: "Recommendation",
      })),
      ...brief.ignore.slice(0, 2).map((line) => ({
        title: line.what,
        detail: line.why,
        source: line.id,
        kind: "Interpretation",
      })),
      ...(brief.moves.length === 0
        ? [{ title: "Nothing stored", detail: "No task, decision, or opportunity currently needs Hayden.", source: "brief", kind: "Fact" }]
        : []),
    ],
  };
}

function metaAnswer(db: Database.Database): CommandAnswer {
  const context = retrieveContext(db);
  const live = context.metrics.filter((metric) => metric.data_status === "live" && /meta|facebook|instagram/i.test(`${metric.metric_key} ${metric.label}`));
  if (live.length === 0) {
    return {
      heading: "Meta",
      summary: "No live Meta Ads data is connected.",
      items: [
        {
          title: "What would be needed",
          detail: "A live Meta Ads connection, or a metric stored with data status live. A historical note is not yesterday's result.",
          source: "integrations meta-ads",
          kind: "Unknown",
        },
      ],
    };
  }
  return {
    heading: "Meta",
    summary: "Live Meta records are stored.",
    items: live.map((metric) => ({
      title: metric.label,
      detail: `${metric.value}. Updated ${metric.last_updated ?? metric.metric_date}.`,
      source: `metric ${metric.id}`,
      kind: "Fact",
    })),
  };
}
