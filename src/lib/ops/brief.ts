import type Database from "better-sqlite3";
import { dataQuality, scorecard } from "@/lib/ops/analyse";
import { listOpsFindings } from "@/lib/ops/findings";

export function operationsBrief(db: Database.Database, organisationId: string, organisationName: string, start: string, end: string) {
  const quality = dataQuality(db, organisationId, end);
  const appointments = quality.find((item) => item.name === "Appointments");
  if (!appointments || appointments.state === "missing") {
    return {
      headline: `${organisationName} has no operational data stored.`,
      sections: [{ title: "Data gaps", lines: ["Appointments, calls, sales, and revenue are missing. Hayden OS will not estimate them."] }],
    };
  }
  const card = scorecard(db, organisationId, start, end);
  const findings = listOpsFindings(db, organisationId);
  const lines = [
    card.confirmed ? `Show rate ${card.counts.sat}/${card.counts.denominator}.` : "Show rate is not confirmed for this business yet.",
    `Appointments stored in the period: ${card.booked}. Sat: ${card.sat}.`,
    `Source: ${card.source}.`,
  ];
  return {
    headline: `${organisationName}, ${start} to ${end}.`,
    sections: [
      { title: "Current period", lines },
      { title: "What changed", lines: card.meaningful && card.points !== null ? [`Show rate moved ${Math.round(card.points)} percentage points. Previous ${card.previous.sat}/${card.previous.denominator}. Current ${card.counts.sat}/${card.counts.denominator}.`] : ["No meaningful period change is stored."] },
      { title: "What needs action", lines: findings.filter((item) => item.severity === "action").map((item) => item.what_happened).slice(0, 5) },
      { title: "Being handled", lines: findings.filter((item) => item.hayden_required === 0 && item.task_id).map((item) => item.recommended_action) },
      { title: "Watching", lines: findings.filter((item) => item.severity === "watch").map((item) => item.what_happened).slice(0, 5) },
      { title: "Data gaps", lines: quality.filter((item) => item.state !== "complete").map((item) => `${item.name}: ${item.state}. ${item.detail}`) },
    ].map((section) => ({ ...section, lines: section.lines.length ? section.lines : ["Nothing stored."] })),
  };
}
