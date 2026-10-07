import type Database from "better-sqlite3";
import type { CommandAnswer } from "@/lib/command/answer";
import { getPack } from "@/lib/factory/store";
import { approveDeliverable, assignExecution, cancelWork, requestChanges } from "@/lib/work/execute";
import { executorFromText, suggestOwner } from "@/lib/work/people";
import { pendingSuggestion, saveSuggestion } from "@/lib/work/rules";
import { haydenQueue, listWork, staleLabel, staleWork } from "@/lib/work/state";

export function isWorkQuestion(query: string) {
  const text = query.toLowerCase();
  if (/give this to|have \w+ (make|finish)|can handle this|who should own|what is everyone working on|what'?s everyone working|what has \w+ got|what has \w+ finished|what is \w+ working on|show me what \w+ is working|what'?s waiting on me|what is waiting on me|what'?s blocked|what is blocked|what'?s stuck|what is stuck|sitting there doing nothing|what can i ignore|closest to (being )?finished|blocked because of me|not worth doing|ask \w+ for changes|approve this|save that feedback|save this feedback|which projects haven'?t moved/.test(text)) {
    return true;
  }
  return false;
}

export function answerWork(db: Database.Database, query: string): CommandAnswer {
  const text = query.toLowerCase();
  const items = listWork(db);

  if (/what is everyone working on|what'?s everyone working/.test(text)) {
    const active = items.filter((row) => !["COMPLETE", "CANCELLED"].includes(row.stage));
    return {
      heading: "What everyone is working on",
      summary: active.length ? `${active.length} open pieces of work are stored.` : "Nothing is stored in progress.",
      items: active.slice(0, 12).map(line),
    };
  }

  if (/what'?s waiting on me|what is waiting on me|blocked because of me/.test(text)) {
    const mine = text.includes("blocked because of me")
      ? items.filter((row) => row.haydenRequired && row.stage === "BLOCKED")
      : haydenQueue(db);
    return {
      heading: text.includes("blocked") ? "Blocked because of you" : "Waiting on you",
      summary: mine.length ? `${mine.length} stored items need you.` : "Nothing stored needs you.",
      items: mine.map(line),
    };
  }

  if (/what'?s stuck|what is stuck|what'?s blocked|what is blocked/.test(text)) {
    const blocked = items.filter((row) => row.stage === "BLOCKED");
    return {
      heading: "Blocked work",
      summary: blocked.length ? `${blocked.length} items are blocked.` : "Nothing stored is blocked.",
      items: blocked.map((row) => ({
        title: row.title,
        detail: `${row.blockedReason ?? "No reason stored."} Waiting on ${row.waitingOn ?? "unknown"}. ${row.haydenRequired ? "This one needs you." : "This one does not need you."}`,
        href: row.href,
        source: row.organisation ?? "work",
        kind: "Fact",
      })),
    };
  }

  const person = executorFromText(text);
  if ((/what has \w+ got|what has \w+ finished|what is \w+ working on|show me what \w+ is working/.test(text)) && person) {
    const finished = /finished/.test(text);
    const rows = items.filter((row) => row.ownerId === person && (finished ? row.stage === "COMPLETE" : row.stage !== "CANCELLED"));
    const name = rows[0]?.ownerName ?? person;
    return {
      heading: finished ? `What ${name} has finished` : `What ${name} has`,
      summary: rows.length ? `${rows.length} stored.` : `Nothing stored for ${name}.`,
      items: rows.map(line),
    };
  }

  if (/sitting there doing nothing/.test(text)) {
    const idle = items.filter((row) => row.stage === "READY FOR EXECUTION" || (row.stage === "ASSIGNED" && row.sourceType === "production_pack"));
    return {
      heading: "Sitting still",
      summary: idle.length ? `${idle.length} items are assigned or ready and not in progress.` : "Nothing stored is sitting unstarted.",
      items: idle.map(line),
    };
  }

  if (/what can i ignore/.test(text)) {
    const ignore = items.filter((row) => !row.haydenRequired && !["COMPLETE", "CANCELLED"].includes(row.stage));
    return {
      heading: "You can ignore these",
      summary: ignore.length ? "These do not need you." : "Nothing open is stored away from you.",
      items: ignore.slice(0, 12).map(line),
    };
  }

  if (/closest to (being )?finished/.test(text)) {
    const rank = ["READY FOR REVIEW", "CHANGES REQUESTED", "IN PROGRESS", "ASSIGNED"];
    const close = items
      .filter((row) => rank.includes(row.stage))
      .sort((a, b) => rank.indexOf(a.stage) - rank.indexOf(b.stage));
    return {
      heading: "Closest to finished",
      summary: close.length ? `${close[0].title} is the furthest along.` : "Nothing stored is in execution.",
      items: close.slice(0, 8).map(line),
    };
  }

  if (/which projects haven'?t moved/.test(text)) {
    const stale = staleWork(items);
    return {
      heading: "No movement",
      summary: stale.length ? `${stale.length} things have not moved.` : "Nothing stored has gone quiet.",
      items: stale.map((row) => ({
        title: row.title,
        detail: staleLabel(row),
        href: row.href,
        source: row.organisation ?? "work",
        kind: "Fact",
      })),
    };
  }

  if (/who should own/.test(text)) {
    const resolved = resolvePack(db, text);
    if (resolved.kind !== "pack") return resolved.answer;
    const suggestion = suggestOwner(db, { sourceType: "production_pack", productionType: resolved.pack.production_type, title: resolved.pack.brand });
    return {
      heading: "Who should own this",
      summary: suggestion.reason,
      items: suggestion.ownerId
        ? [{ title: suggestion.ownerId, detail: suggestion.certain ? "This is a stored role, not a guess." : "Uncertain.", href: `/work/pack/${resolved.pack.id}`, source: "people", kind: "Fact" }]
        : [],
    };
  }

  if (/not worth doing/.test(text)) {
    const resolved = resolvePack(db, text);
    if (resolved.kind !== "pack") return resolved.answer;
    cancelWork(db, resolved.pack.id);
    return { heading: "Closed", summary: "Marked not worth doing. It will not ask for your attention.", items: [] };
  }

  if (/approve this/.test(text)) {
    const resolved = resolvePack(db, text);
    if (resolved.kind !== "pack") return resolved.answer;
    const result = approveDeliverable(db, resolved.pack.id);
    return { heading: "Approved", summary: result.summary, items: [] };
  }

  if (/ask \w+ for changes/.test(text)) {
    const resolved = resolvePack(db, text);
    if (resolved.kind !== "pack") return resolved.answer;
    const feedback = query.split(/changes[:\s]+/i)[1]?.trim();
    if (!feedback) return { heading: "Changes", summary: "Write the change in the same sentence.", items: [] };
    const result = requestChanges(db, resolved.pack.id, feedback);
    return {
      heading: "Changes requested",
      summary: result.suggestionId
        ? "The version is kept. A reusable preference is suggested and is not saved until you approve it."
        : "The version is kept. The executor can submit another one.",
      items: [{ title: "Review", detail: "Open the pack to save or dismiss a rule.", href: `/work/pack/${resolved.pack.id}/review`, source: "work", kind: "Fact" }],
    };
  }

  if (/save (that|this) feedback/.test(text)) {
    const pending = db
      .prepare(`SELECT id, title FROM rule_suggestions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`)
      .get() as { id: string; title: string } | undefined;
    if (!pending) return { heading: "Production rule", summary: "There is no suggested rule waiting.", items: [] };
    saveSuggestion(db, pending.id);
    return { heading: "Production rule", summary: `Saved: ${pending.title}. It applies from here on, and the old comment stays on the version.`, items: [] };
  }

  if (/give this to|have \w+ (make|finish)|can handle this/.test(text)) {
    const owner = executorFromText(text);
    if (!owner) return { heading: "Assignment", summary: "Say Lily, Danny, AP, Nic, or yourself.", items: [] };
    const resolved = resolvePack(db, text);
    if (resolved.kind !== "pack") return resolved.answer;
    const result = assignExecution(db, resolved.pack.id, owner);
    const suggestion = pendingSuggestion(db, "production_pack", resolved.pack.id);
    return {
      heading: "Assigned",
      summary: result.note,
      items: [
        { title: "Open the brief", detail: suggestion ? "A rule suggestion is still waiting." : "The executor sees the brief, not the Business Brain.", href: `/work/pack/${resolved.pack.id}`, source: "work", kind: "Fact" },
      ],
    };
  }

  return { heading: "Work", summary: "I could not match that to stored work.", items: [] };
}

function line(row: { title: string; stage: string; ownerName: string | null; nextAction: string; haydenRequired: boolean; href: string; organisation: string | null }) {
  return {
    title: row.title,
    detail: `${row.organisation ?? "Unassigned"} · ${row.ownerName ?? "Unassigned"} · ${row.stage}. ${row.nextAction}${row.haydenRequired ? " Needs you." : ""}`,
    href: row.href,
    source: row.organisation ?? "work",
    kind: "Fact",
  };
}

function resolvePack(db: Database.Database, text: string): { kind: "pack"; pack: NonNullable<ReturnType<typeof getPack>> } | { kind: "ask"; answer: CommandAnswer } {
  const rows = db
    .prepare(
      `SELECT id, brand, organisation_id FROM production_packs
       WHERE status NOT IN ('complete', 'archived')
         AND NOT EXISTS (SELECT 1 FROM production_packs newer WHERE newer.supersedes_id = production_packs.id)
       ORDER BY updated_at DESC`,
    )
    .all() as Array<{ id: string; brand: string | null; organisation_id: string | null }>;
  if (rows.length === 0) {
    return { kind: "ask", answer: { heading: "Work", summary: "No open production pack is stored.", items: [] } };
  }
  const named = rows.filter((row) => brandMatch(text, row));
  const brandNamed = /property made simple|\bpms\b|\bfifo\b|inception|\bwlth\b/.test(text);
  const chosen = brandNamed ? named : rows.length === 1 ? rows : [];
  if (chosen.length !== 1) {
    return {
      kind: "ask",
      answer: {
        heading: "Which pack?",
        summary: "More than one pack could match. Say the brand.",
        items: rows.map((row) => ({ title: row.brand ?? "Pack", detail: "Open it.", href: `/work/pack/${row.id}`, source: "work", kind: "Fact" })),
      },
    };
  }
  const pack = getPack(db, chosen[0].id);
  if (!pack) return { kind: "ask", answer: { heading: "Work", summary: "That pack is not stored.", items: [] } };
  return { kind: "pack", pack };
}

function brandMatch(text: string, row: { brand: string | null; organisation_id: string | null }) {
  if (/property made simple|\bpms\b/.test(text)) return row.organisation_id === "property-made-simple" || /property made simple/i.test(row.brand || "");
  if (/\bfifo\b/.test(text)) return row.organisation_id === "fifo" || /fifo/i.test(row.brand || "");
  if (/inception/.test(text)) return row.organisation_id === "inception" || /inception/i.test(row.brand || "");
  if (/\bwlth\b/.test(text)) return row.organisation_id === "wlth" || /wlth/i.test(row.brand || "");
  return false;
}
