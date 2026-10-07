import type Database from "better-sqlite3";
import type { CommandAnswer } from "@/lib/command/answer";
import { appointmentsIn, bringForward, dataQuality, drillShowRate, percent, previousPeriod, rateText, scorecard, setterBoard, unattendedNoShows } from "@/lib/ops/analyse";
import { joshBookingReport } from "@/lib/ops/booking";
import { noShowRows } from "@/lib/ops/noshow";
import { brisbaneRange, brisbaneToday, brisbaneWeekStart, formatLongDate, formatShortDate } from "@/lib/dates";
import { healthLabel, readSyncState } from "@/lib/ops/sync-state";
import { pipelineIssues, setterActivity, setterCallRows } from "@/lib/ops/live";
import { operationsBrief } from "@/lib/ops/brief";
import { createWorkFromFinding, listOpsFindings, refreshFindings } from "@/lib/ops/findings";
import { confirmKpi, definitionFor, KPI_CATALOG } from "@/lib/ops/kpis";
import { listWork } from "@/lib/work/state";

export function isOpsQuestion(query: string) {
  return /show rate|appointments sat|no-?shows?|bring forward|setters?|booking rate|pipeline (cleanup|hygiene)|stale lead|operations brief|what data|data are we missing|data quality|turn this finding|how did .+ perform|what'?s going wrong|what is going wrong|what changed since|leaking appointments|below their targets|unattended|what can \w+ handle|waiting on (ap|nic)|give ap the pipeline|appointments looking|might not|partner|brought forward|calls did|how many calls?|sitting untouched|needs me|josh|fresh|analysed|bookings|couldn'?t/i.test(query);
}

export function answerOps(db: Database.Database, query: string): CommandAnswer {
  const text = query.toLowerCase();
  const live = answerLive(db, text);
  if (live) return live;
  const org = resolveOrg(db, text);

  if (/what data|data are we missing|data quality/.test(text)) {
    if (!org) return missingOrg();
    const quality = dataQuality(db, org.id, new Date().toISOString().slice(0, 10));
    return { heading: `${org.name} data`, summary: "This is what is stored, and what is not.", items: quality.map((item) => ({ title: item.name, detail: `${item.state}. ${item.detail}`, source: org.name, kind: "Fact" })) };
  }

  if (/operations brief/.test(text)) {
    if (!org) return missingOrg();
    const range = storedRange(db, org.id);
    if (!range) return unavailable(org.name);
    const brief = operationsBrief(db, org.id, org.name, range.start, range.end);
    return { heading: "Operations brief", summary: brief.headline, items: brief.sections.map((section) => ({ title: section.title, detail: section.lines.join(" "), source: org.name, kind: "Fact" })) };
  }

  if (/turn this finding|give ap the pipeline/.test(text)) {
    const findings = listOpsFindings(db, org?.id);
    const finding = /pipeline/.test(text) ? findings.find((item) => /clean up|pipeline|booked/.test(item.recommended_action.toLowerCase())) ?? findings.find((item) => item.suggested_owner_id === "ap") : findings[0];
    if (!finding) return { heading: "Operations", summary: "No open operational finding is stored to turn into work.", items: [] };
    const taskId = createWorkFromFinding(db, finding.id);
    const work = listWork(db).find((item) => item.sourceId === taskId);
    return {
      heading: "Work created",
      summary: `${finding.recommended_action} is now work for ${work?.ownerName ?? "an owner"}. ${work?.haydenRequired ? "It needs you." : "It does not need you."}`,
      items: [{ title: finding.recommended_action, detail: finding.what_happened, href: "/work", source: "operations", kind: "Fact" }],
    };
  }

  if (/what can (\w+) handle|waiting on (ap|nic)/.test(text)) {
    const person = /nic/.test(text) ? "nic" : "ap";
    const findings = listOpsFindings(db).filter((item) => item.suggested_owner_id === person);
    const tasks = listWork(db).filter((item) => item.ownerId === person && item.sourceType === "task");
    const name = person === "nic" ? "Nic" : "AP";
    if (!findings.length && !tasks.length) return { heading: name, summary: `Nothing operational is stored for ${name}.`, items: [] };
    return {
      heading: name,
      summary: `${name} can take the stored operational work. ${findings.every((item) => item.hayden_required === 0) ? "None of these findings need you." : "One of them needs a decision from you."}`,
      items: [...findings.map((item) => ({ title: item.recommended_action, detail: item.what_happened, source: "operations", kind: "Fact" })), ...tasks.map((item) => ({ title: item.title, detail: item.stage, href: item.href, source: "work", kind: "Fact" }))],
    };
  }

  if (!org) {
    const any = db.prepare(`SELECT COUNT(*) AS n FROM ops_appointments`).get() as { n: number };
    if (any.n === 0) return { heading: "Operations", summary: "No operational data is stored, so there is nothing to interpret.", items: [] };
    return missingOrg();
  }
  const range = storedRange(db, org.id);
  if (!range && /perform|show rate|appointment|no-?show|setter|bring forward|going wrong|changed since|leaking/.test(text)) return unavailable(org.name);

  if (/no-?shows?|unattended/.test(text)) {
    const rows = unattendedNoShows(db, org.id);
    return {
      heading: "No-shows with no follow-up",
      summary: rows.length ? `${rows.length} stored no-show${rows.length === 1 ? "" : "s"} ha${rows.length === 1 ? "s" : "ve"} no rebooking attempt.` : "No unattended no-shows are stored.",
      items: rows.map((row) => ({ title: row.scheduled_at ?? "Undated", detail: `${row.setter_name ?? "Owner not stored"}. Rebooking attempt: not stored.`, source: org.name, kind: "Fact" })),
    };
  }

  if (/bring forward/.test(text)) {
    const rows = bringForward(appointmentsIn(db, org.id));
    return {
      heading: "Bring forward",
      summary: rows.length ? "These records contain a reason to ask. An earlier calendar slot is not known, because no calendar is connected." : "No stored evidence supports bringing an appointment forward.",
      items: rows.map((row) => ({ title: row.scheduled_at ?? "Undated", detail: `${row.attendance_evidence} Earlier slot: unknown.`, source: org.name, kind: "Fact" })),
    };
  }

  if (/setter|below their targets/.test(text)) {
    const board = setterBoard(db, org.id, range?.start, range?.end);
    if (/below their targets/.test(text) && board.every((row) => row.target === null)) {
      return { heading: "Setter targets", summary: `No setter show-rate targets are stored for ${org.name}. Hayden OS will not invent them.`, items: board.map((row) => ({ title: row.name, detail: row.showRate === null ? "No expected appointments." : `${percent(row.showRate)} (${row.sat}/${row.expected})`, source: org.name, kind: "Fact" })) };
    }
    return {
      heading: "Setters",
      summary: "These are the stored appointment counts. There is no single score.",
      items: board.map((row) => ({ title: row.name, detail: `${row.showRate === null ? "Show rate not available" : percent(row.showRate)} (${row.sat}/${row.expected}). Dials: ${row.dials === null ? "not stored" : row.dials}.${row.belowTarget ? " Below the stored target." : ""}`, source: org.name, kind: "Fact" })),
    };
  }

  if (/why|drop|changed since|leaking|going wrong/.test(text)) {
    const rows = appointmentsIn(db, org.id, range?.start, range?.end);
    refreshFindings(db, org.id, rows, range ?? undefined);
    const drilled = drillShowRate(rows);
    if (!definitionFor(db, org.id, "show_rate")) return askForFormula(org.name);
    const cause = drilled.concentrated[0];
    return {
      heading: "Why",
      summary: cause ? `The lower show rate is concentrated in ${cause.name}: ${cause.sat}/${cause.denominator}. Overall ${drilled.overall.sat}/${drilled.overall.denominator}.` : `Overall ${rateText(drilled.overall)}. No stored dimension explains a concentration.`,
      items: [...drilled.setters, ...drilled.delays].map((group) => ({ title: group.name, detail: group.rate === null ? "No expected appointments." : `${percent(group.rate)} (${group.sat}/${group.denominator})`, source: org.name, kind: "Fact" })),
    };
  }

  if (/show rate|perform|appointments sat|what changed/.test(text)) {
    if (!range) return unavailable(org.name);
    if (!definitionFor(db, org.id, "show_rate") && /show rate|perform/.test(text)) return askForFormula(org.name);
    const card = scorecard(db, org.id, range.start, range.end);
    const movement = card.meaningful && card.points !== null ? ` A ${Math.round(card.points)} percentage point move is large enough to treat as a change. Previous ${card.previous.sat}/${card.previous.denominator}.` : ` Previous ${card.previous.sat}/${card.previous.denominator}. The movement is not being called a trend.`;
    return {
      heading: org.name,
      summary: `${card.confirmed ? `Show rate ${rateText(card.counts)}.` : "Show rate is not confirmed."} Sat ${card.sat}. Appointments ${card.booked}.${movement} Source: ${card.source}.`,
      items: [{ title: "Formula", detail: `${card.formula}. Counts ${card.counts.sat}/${card.counts.denominator}.`, source: card.source, kind: "Fact" }],
    };
  }

  return { heading: "Operations", summary: "No operational reading matched that question.", items: [] };
}

function answerLive(db: Database.Database, text: string): CommandAnswer | null {
  const ask = readOpsQuestion(text);
  if (ask.subject === "freshness") {
    const ghl = readSyncState(db, "gohighlevel");
    const air = readSyncState(db, "aircall");
    const which = /aircall/.test(text) ? [["Aircall", air] as const] : /ghl|gohighlevel|go high/.test(text) ? [["GoHighLevel", ghl] as const] : [["GoHighLevel", ghl] as const, ["Aircall", air] as const];
    return {
      heading: "Data health",
      summary: which.map(([name, state]) => `${name} is ${healthLabel(state)}. Last successful sync ${state.lastSuccessfulAt ?? "has not happened"}.`).join(" "),
      items: which.map(([name, state]) => ({ title: name, detail: `${healthLabel(state)}. Latest source record ${state.latestSourceAt ?? "not stored"}. ${state.error ?? state.partialError ?? "No error stored."}`, source: name, kind: "Fact" })),
    };
  }
  if (ask.subject === "calls") return answerCalls(db, ask);
  if (ask.subject === "booking-length") return bookingLengthAnswer(db, ask);
  if (ask.subject === "noshow") {
    const rows = noShowRows(db);
    const confirmed = rows.filter((row) => row.recovery_status === "CONFIRMED NO ATTEMPT");
    const unknown = rows.filter((row) => row.recovery_status === "UNKNOWN — INCOMPLETE DATA");
    return { heading: "No-show recovery", summary: `${confirmed.length} confirmed with no recovery call. ${unknown.length} are unknown because call coverage does not include the period after the no-show.`, items: confirmed.slice(0, 8).map((row) => ({ title: row.name || "Lead", detail: `${row.source} · ${row.occurred_at || "date not stored"} · ${row.recovery_status}`, href: row.lead_id ? `/operations/lead/${row.lead_id}` : undefined, source: "GoHighLevel", kind: "Fact" })) };
  }
  if (ask.subject === "needs") {
    const rows = db.prepare(`SELECT what_happened, recommended_action FROM ops_findings WHERE status = 'open' AND hayden_required = 1`).all() as Array<{ what_happened: string; recommended_action: string }>;
    return { heading: "Needs you", summary: rows.length ? "These stored findings need a decision from you." : "No stored operational finding needs you.", items: rows.map((row) => ({ title: row.recommended_action, detail: row.what_happened, source: "operations", kind: "Fact" })) };
  }
  if (ask.subject === "pipeline") {
    const issues = pipelineIssues(db);
    return { heading: "Pipeline", summary: "These are stage and appointment mismatches. GoHighLevel was not changed.", items: [{ title: "Booked stage, no appointment", detail: String(issues.bookedWithoutAppointment), source: "GoHighLevel", kind: "Fact" }, { title: "No-show stage", detail: String(issues.noShowStage), source: "GoHighLevel", kind: "Fact" }, { title: "Contacts with more than one opportunity", detail: String(issues.duplicateContacts), source: "GoHighLevel", kind: "Fact" }] };
  }
  if (ask.subject) {
    const since = ask.span?.start ?? brisbaneToday(-7);
    const windowLabel = ask.span?.phrase ?? "from the last 7 days";
    const report = joshBookingReport(db, brisbaneToday(), since);
    const uncovered = report.unable ? ` ${report.unable} booking${report.unable === 1 ? "" : "s"} could not be analysed.` : "";
    const coverage = `${report.analysed} of ${report.bookings} Josh bookings ${windowLabel} were analysed.${uncovered}`;
    if (ask.subject === "unable") {
      return { heading: "Bookings not analysed", summary: report.unable ? `${report.unable} of ${report.bookings} bookings could not be analysed.` : `All ${report.bookings} analysed bookings had a transcript.`, items: report.unableRows.slice(0, 8).map((row) => ({ title: row.lead || "Lead", detail: row.reason || "No transcript.", source: "GoHighLevel booking", kind: "Fact" })) };
    }
    if (ask.subject === "coverage") {
      return { heading: "Josh booking coverage", summary: coverage, items: [] };
    }
    if (ask.subject === "bookings") {
      const showing = /show|likelihood|likely/.test(text) ? ` ${bookingOutcomes(db, since, ask.span?.end ?? null)}` : "";
      return { heading: "Josh bookings", summary: `${report.bookings} bookings ${windowLabel}. ${coverage}${showing}`, items: [] };
    }
    if (ask.subject === "status") {
      const callSpan = ask.span ?? spanBetween(brisbaneToday(-6), brisbaneToday(1), "Last 7 days", "in the last 7 days");
      const calls = setterActivity(db, callSpan).find((row) => /josh/i.test(row.name));
      const upcoming = report.lead.length + report.partner.length + report.both.length;
      const callLine = calls ? ` Calls ${callSpan.phrase}: ${calls.calls}, ${calls.connected} answered.` : ` No Josh calls are stored ${callSpan.phrase}.`;
      return {
        heading: "Josh",
        summary: `${report.bookings} bookings ${windowLabel}. ${coverage} ${upcoming} attendance concern${upcoming === 1 ? "" : "s"} on upcoming appointments. ${report.bringForward.length} current bring-forward opportunit${report.bringForward.length === 1 ? "y" : "ies"}.${callLine} Show rate is not available until the formula is confirmed.`,
        items: [],
      };
    }
    if (ask.subject === "bring-forward") {
      return { heading: "Bring forward", summary: report.bringForward.length ? `${report.bringForward.length} upcoming appointment${report.bringForward.length === 1 ? "" : "s"} ha${report.bringForward.length === 1 ? "s" : "ve"} flexibility in the booking call. An earlier slot is not confirmed. ${coverage}` : `No current bring-forward is in the analysed bookings. ${coverage}`, items: report.bringForward.slice(0, 8).map((row) => ({ title: row.lead || "Lead", detail: `${row.speaker}: "${row.evidence}" Appointment ${row.appointmentAt || "time unknown"}. ${row.action}`, href: `/operations/call/${row.callId}`, source: "Aircall transcript", kind: "Fact" })) };
    }
    const wantPartner = ask.subject === "partner" || ask.subject === "exact" || ask.subject === "audit";
    const wantLead = ask.subject === "attendance" || ask.subject === "exact" || ask.subject === "audit";
    const rows = [
      ...(wantLead || (!wantPartner && /exact words|josh|booking/.test(text)) ? [...report.lead, ...report.both] : []),
      ...(wantPartner || /exact words|or their partner|partner might/.test(text) ? [...report.partner, ...report.both] : []),
    ];
    const unique = rows.filter((row, index) => rows.findIndex((item) => item.callId === row.callId && item.signalType === row.signalType && item.evidence === row.evidence) === index);
    if (ask.subject === "exact" && !unique.length) {
      const any = [...report.lead, ...report.partner, ...report.both, ...report.historical].slice(0, 4);
      return { heading: "Exact words", summary: any.length ? coverage : `No attendance evidence is stored. ${coverage}`, items: any.map((row) => ({ title: row.lead || "Lead", detail: `${row.signalType}. ${row.speaker}: "${row.evidence}"`, href: `/operations/call/${row.callId}`, source: "Aircall transcript", kind: "Fact" })) };
    }
    const pastLead = report.historical.filter((row) => row.signalType === "LEAD_ATTENDANCE_CONCERN" || row.signalType === "BOTH_ATTENDANCE_CONCERN");
    const pastPartner = report.historical.filter((row) => row.signalType === "PARTNER_ATTENDANCE_CONCERN" || row.signalType === "BOTH_ATTENDANCE_CONCERN");
    const leadCount = report.lead.length + report.both.length;
    const partnerCount = report.partner.length + report.both.length;
    const spoken = [...unique, ...pastLead, ...pastPartner].filter((row, index, list) => list.findIndex((item) => item.callId === row.callId && item.signalType === row.signalType && item.evidence === row.evidence) === index);
    return {
      heading: "Josh appointment audit",
      summary: `${leadCount} lead attendance concern${leadCount === 1 ? "" : "s"} and ${partnerCount} partner attendance concern${partnerCount === 1 ? "" : "s"} are on upcoming appointments. ${pastLead.length} lead and ${pastPartner.length} partner concern${pastPartner.length === 1 ? "" : "s"} sit on appointments that have passed. ${coverage}`,
      items: spoken.slice(0, 8).map((row) => ({ title: row.lead || "Lead", detail: `${row.timing}. ${row.signalType}. ${row.speaker}: "${row.evidence}" ${row.action}`, href: `/operations/call/${row.callId}`, source: "Aircall transcript", kind: "Fact" })),
    };
  }
  return null;
}

export function confirmShowRate(db: Database.Database, organisationId: string) {
  return confirmKpi(db, organisationId, "show_rate");
}

function askForFormula(name: string) {
  const template = KPI_CATALOG.find((item) => item.key === "show_rate");
  return {
    heading: "Show rate needs a definition",
    summary: `${name} has not confirmed how show rate is calculated. Proposed formula: ${template?.formula}. Denominator: ${template?.denominator}. Confirm it on Operations before it is used.`,
    items: [],
  };
}

function unavailable(name: string) {
  return { heading: name, summary: `No operational data is stored for ${name}. Hayden OS will not estimate appointments, show rate, sales, or revenue.`, items: [] };
}

function missingOrg() {
  return { heading: "Which business?", summary: "Name the business. Operational data is kept separate.", items: [] };
}

function resolveOrg(db: Database.Database, text: string) {
  const orgs = db.prepare(`SELECT id, name FROM organisations WHERE status = 'active'`).all() as Array<{ id: string; name: string }>;
  const named = orgs.find((org) => text.includes(org.name.toLowerCase()) || (org.id === "fifo" && /\bfifo\b/.test(text)) || (org.id === "wlth" && /\bwlth\b/.test(text)) || (org.id === "property-made-simple" && /property made simple|\bpms\b/.test(text)));
  if (named) return named;
  const withData = orgs.filter((org) => (db.prepare(`SELECT COUNT(*) AS n FROM ops_appointments WHERE organisation_id = ?`).get(org.id) as { n: number }).n > 0);
  if (withData.length === 1) return withData[0];
  return null;
}

function storedRange(db: Database.Database, organisationId: string) {
  const row = db.prepare(`SELECT MIN(scheduled_at) AS start, MAX(scheduled_at) AS end FROM ops_appointments WHERE organisation_id = ? AND scheduled_at IS NOT NULL`).get(organisationId) as { start: string | null; end: string | null };
  if (!row.start || !row.end) return null;
  return { start: row.start, end: row.end };
}

export function windowBefore(start: string, end: string) {
  return previousPeriod(start, end);
}

type OpsSubject = "freshness" | "calls" | "booking-length" | "noshow" | "needs" | "pipeline" | "unable" | "coverage" | "bookings" | "status" | "bring-forward" | "exact" | "partner" | "attendance" | "audit";

type OpsAsk = {
  subject: OpsSubject | null;
  person: string;
  span: CallSpan | null;
  grain: "total" | "day" | "hour";
};

function readOpsQuestion(text: string): OpsAsk {
  const person = /\bjosh(?:es|'s|s)?\b/.test(text) ? "josh" : "";
  const wantsHour = /hour by hour|by hour|each hour|per hour/.test(text);
  const wantsDay = /day by day|by day|each day|per day/.test(text);
  const grain = wantsHour ? "hour" : wantsDay ? "day" : "total";
  const span = askedSpan(text);
  const countingCalls = /\b(calls?|dials?)\b/.test(text) && (/how many|\bmade\b|\bdone\b|\bdid\b|broken|breakdown|by day|by hour|each day|each hour/.test(text) || grain !== "total");
  let subject: OpsSubject | null = null;
  if (/how fresh|freshness|fresh is/.test(text)) subject = "freshness";
  else if (countingCalls) subject = "calls";
  else if (/(how long|\bavg\b|average|on average)/.test(text) && /bookings?/.test(text)) subject = "booking-length";
  else if (/couldn'?t|unable|not analysed|unanalysed/.test(text)) subject = "unable";
  else if (/exact words/.test(text)) subject = "exact";
  else if (/bring forward|brought forward/.test(text)) subject = "bring-forward";
  else if (/\bpartner\b/.test(text)) subject = "partner";
  else if (/might not|make the appointment|make it|attendance/.test(text)) subject = "attendance";
  else if (/no-?shows?|haven'?t been chased|untouched/.test(text)) subject = "noshow";
  else if (/how many/.test(text) && /analys/.test(text)) subject = "coverage";
  else if (/how many/.test(text) && /bookings?/.test(text)) subject = "bookings";
  else if (/\b(going|doing)\b/.test(text) && person) subject = "status";
  else if (/needs me/.test(text)) subject = "needs";
  else if (/pipeline/.test(text) && /booked|issue/.test(text)) subject = "pipeline";
  else if (person || /\bbookings?\b/.test(text)) subject = "audit";
  return { subject, person, span, grain };
}

function bookingLengthAnswer(db: Database.Database, ask: OpsAsk): CommandAnswer {
  const since = ask.span?.start ?? brisbaneToday(-6);
  const until = ask.span?.end ?? null;
  const phrase = ask.span?.phrase ?? "in the last 7 days";
  const rows = db.prepare(
    `SELECT l.name AS lead, a.scheduled_at, a.ends_at
     FROM ops_booking_reviews r
     JOIN ops_appointments a ON a.id = r.appointment_id
     LEFT JOIN ops_leads l ON l.id = r.lead_id
     WHERE r.booked_at >= ? AND (? IS NULL OR r.booked_at < ?)
     ORDER BY a.scheduled_at`,
  ).all(since, until, until) as Array<{ lead: string | null; scheduled_at: string | null; ends_at: string | null }>;
  const timed = rows.flatMap((row) => {
    if (!row.scheduled_at || !row.ends_at) return [];
    const minutes = Math.round((Date.parse(row.ends_at) - Date.parse(row.scheduled_at)) / 60000);
    if (!Number.isFinite(minutes) || minutes <= 0) return [];
    return [{ ...row, minutes }];
  });
  if (!rows.length) return { heading: "Booking length", summary: `No Josh bookings are stored ${phrase}.`, items: [] };
  if (!timed.length) return { heading: "Booking length", summary: `${rows.length} Josh bookings ${phrase}. The appointment end time is not stored, so the length cannot be calculated.`, items: [] };
  const average = Math.round(timed.reduce((sum, row) => sum + row.minutes, 0) / timed.length);
  const missing = rows.length - timed.length;
  return {
    heading: "Booking length",
    summary: `Josh's bookings ${phrase} average ${average} minutes. That is the scheduled appointment length, from the start time to the end time. ${timed.length} of ${rows.length} have an end time.${missing ? ` ${missing} ${missing === 1 ? "does" : "do"} not.` : ""}`,
    items: timed.map((row) => ({ title: row.lead || "Lead", detail: `${row.minutes} minutes. ${formatWhen(row.scheduled_at)}`, source: "GoHighLevel", kind: "Fact" as const })),
  };
}

function bookingOutcomes(db: Database.Database, since: string, until: string | null) {
  const rows = db.prepare(
    `SELECT a.status, COUNT(*) AS n
     FROM ops_booking_reviews r
     JOIN ops_appointments a ON a.id = r.appointment_id
     WHERE r.booked_at >= ? AND (? IS NULL OR r.booked_at < ?)
     GROUP BY a.status`,
  ).all(since, until, until) as Array<{ status: string; n: number }>;
  if (!rows.length) return "No appointment status is stored for those bookings.";
  const listed = rows.map((row) => `${row.n} ${row.status}`).join(", ");
  const decided = rows.some((row) => row.status === "sat" || row.status === "no_show");
  return decided
    ? `Stored appointment status: ${listed}. Show rate is still not confirmed as a formula.`
    : `Stored appointment status: ${listed}. None are stored as sat or no-show, so a show likelihood cannot be calculated.`;
}

function formatWhen(iso: string | null) {
  if (!iso) return "time unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

function answerCalls(db: Database.Database, ask: OpsAsk): CommandAnswer {
  const freshness = `Aircall is ${healthLabel(readSyncState(db, "aircall")).toLowerCase()}.`;
  if (ask.grain !== "total") return callBreakdownAnswer(db, ask, freshness);
  const rows = setterActivity(db, ask.span).filter((row) => !ask.person || row.name.toLowerCase().includes(ask.person));
  const who = ask.person ? "Josh has" : "There are";
  if (!rows.length) return { heading: "Calls", summary: `${who} no calls stored ${ask.span?.phrase ?? "in Hayden OS"}. ${freshness}`, items: [] };
  if (rows.length === 1) {
    const row = rows[0];
    const when = ask.span?.phrase ?? `across stored calls from ${formatShortDate(row.first_at)} to ${formatShortDate(row.last_at)}`;
    const talk = row.talk_seconds ? `${Math.round(row.talk_seconds / 60)} minutes` : "not stored";
    return { heading: "Calls", summary: `${row.name} has made ${row.calls} call${row.calls === 1 ? "" : "s"} ${when}. ${row.connected} answered. Talk time ${talk}. ${freshness}`, items: [] };
  }
  const period = ask.span?.label ?? storedCallLabel(rows);
  return { heading: "Calls", summary: `${period}. Connected means the call was answered. ${freshness}`, items: rows.map((row) => ({ title: row.name, detail: `${row.calls} calls. ${row.connected} answered. Talk time ${row.talk_seconds ? `${Math.round(row.talk_seconds / 60)} minutes` : "not stored"}.`, source: "Aircall", kind: "Fact" })) };
}

function askedSpan(text: string): CallSpan | null {
  if (/\btoday\b/.test(text)) return spanBetween(brisbaneToday(0), brisbaneToday(1), `Today, ${formatLongDate()}`, "so far today");
  if (/\byesterday\b/.test(text)) return spanBetween(brisbaneToday(-1), brisbaneToday(0), `Yesterday, ${formatShortDate(brisbaneToday(-1))}`, "yesterday");
  if (/fortnight|last 14 days|past 14 days|two weeks/.test(text)) return spanBetween(brisbaneToday(-13), brisbaneToday(1), "Last 14 days", "in the last 14 days");
  if (/this week/.test(text)) return spanBetween(brisbaneWeekStart(0), brisbaneToday(1), "This week", "this week");
  if (/the last week|past week|last 7 days|past 7 days/.test(text)) return spanBetween(brisbaneToday(-6), brisbaneToday(1), "The last 7 days", "in the last 7 days");
  if (/last week/.test(text)) return spanBetween(brisbaneWeekStart(-1), brisbaneWeekStart(0), "Last week", "last week");
  return null;
}

function spanBetween(startDay: string, endDay: string, label: string, phrase: string): CallSpan {
  return { ...brisbaneRange(startDay, endDay), startDay, endDay, label, phrase };
}

type CallSpan = { start: string; end: string; startDay: string; endDay: string; label: string; phrase: string };

function callBreakdownAnswer(db: Database.Database, ask: OpsAsk, freshness: string): CommandAnswer {
  const window = ask.span ?? spanBetween("2020-01-01", brisbaneToday(1), "Stored calls", "across the stored calls");
  const byHour = ask.grain === "hour";
  const calls = setterCallRows(db, window, ask.person);
  const who = ask.person ? "Josh" : "The team";
  const days = new Map<string, Map<number, { calls: number; answered: number }>>();
  if (ask.span) {
    for (let day = window.startDay; day < window.endDay; day = nextDay(day)) days.set(day, new Map());
  }
  for (const call of calls) {
    const part = brisbanePart(call.at);
    if (ask.span && (part.day < window.startDay || part.day >= window.endDay)) continue;
    const hours = days.get(part.day) ?? new Map<number, { calls: number; answered: number }>();
    const hour = hours.get(part.hour) ?? { calls: 0, answered: 0 };
    hour.calls += 1;
    hour.answered += call.answered;
    hours.set(part.hour, hour);
    days.set(part.day, hours);
  }
  const total = calls.length;
  const answered = calls.reduce((sum, call) => sum + call.answered, 0);
  const items = [...days.entries()].map(([day, hours]) => {
    const dayCalls = [...hours.values()].reduce((sum, hour) => sum + hour.calls, 0);
    const dayAnswered = [...hours.values()].reduce((sum, hour) => sum + hour.answered, 0);
    const lines = [...hours.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, count]) => `${hourLabel(hour)} — ${count.calls} call${count.calls === 1 ? "" : "s"}, ${count.answered} answered`);
    return {
      title: `${dayLabel(day)} — ${dayCalls} call${dayCalls === 1 ? "" : "s"}, ${dayAnswered} answered`,
      detail: byHour ? (lines.join("\n") || "No calls.") : `${dayAnswered} answered.`,
      source: "Aircall",
      kind: "Fact" as const,
    };
  });
  const listed = [...days.keys()];
  const from = ask.span ? dayLabel(window.startDay) : listed[0] ? dayLabel(listed[0]) : "the stored start";
  const to = ask.span ? dayLabel(previousDay(window.endDay)) : listed.length ? dayLabel(listed[listed.length - 1]) : "now";
  const phrase = ask.span?.phrase ?? "across the stored calls";
  return {
    heading: `${who}'s calls`,
    summary: `${who} made ${total} call${total === 1 ? "" : "s"} ${phrase}, ${from} to ${to}. ${answered} answered. Brisbane time. Hours with no calls are left out. ${freshness}`,
    items,
  };
}

function brisbanePart(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { day: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}

function dayLabel(day: string) {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(new Date(`${day}T00:00:00Z`));
}

function hourLabel(hour: number) {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

function nextDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

function previousDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}

function storedCallLabel(rows: Array<{ first_at: string | null; last_at: string | null }>) {
  const times = rows.flatMap((row) => [row.first_at, row.last_at]).filter((value): value is string => Boolean(value)).sort();
  if (!times.length) return "All stored calls";
  return `All stored calls, ${formatShortDate(times[0])} to ${formatShortDate(times[times.length - 1])}`;
}
