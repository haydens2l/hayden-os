import type Database from "better-sqlite3";

export const KPI_CATALOG = [
  { key: "leads", label: "Leads", formula: "Count of stored leads", numerator: "leads", denominator: "none", ambiguous: 0 },
  { key: "dials", label: "Dials", formula: "Count of stored dial activities", numerator: "dials", denominator: "none", ambiguous: 0 },
  { key: "contacts", label: "Contacts", formula: "Count of stored contacts", numerator: "contacts", denominator: "none", ambiguous: 0 },
  { key: "appointments_booked", label: "Appointments booked", formula: "Count of stored appointments", numerator: "appointments", denominator: "none", ambiguous: 0 },
  { key: "appointments_sat", label: "Appointments sat", formula: "Count of appointments with status sat", numerator: "sat", denominator: "none", ambiguous: 0 },
  { key: "no_shows", label: "No-shows", formula: "Count of appointments with status no-show", numerator: "no_show", denominator: "none", ambiguous: 0 },
  { key: "cancelled", label: "Cancelled", formula: "Count of appointments with status cancelled", numerator: "cancelled", denominator: "none", ambiguous: 0 },
  { key: "rescheduled", label: "Rescheduled", formula: "Count of appointments with status rescheduled", numerator: "rescheduled", denominator: "none", ambiguous: 0 },
  { key: "qualified", label: "Qualified", formula: "Count of stored qualified outcomes", numerator: "qualified", denominator: "none", ambiguous: 0 },
  { key: "unqualified", label: "Unqualified", formula: "Count of stored unqualified outcomes", numerator: "unqualified", denominator: "none", ambiguous: 0 },
  { key: "sales", label: "Sales", formula: "Count of stored sale outcomes", numerator: "sales", denominator: "none", ambiguous: 0 },
  { key: "revenue", label: "Revenue", formula: "Sum of stored sale revenue", numerator: "revenue", denominator: "none", ambiguous: 0 },
  { key: "cost", label: "Cost", formula: "Sum of stored cost", numerator: "cost", denominator: "none", ambiguous: 1 },
  { key: "cpl", label: "CPL", formula: "cost / leads", numerator: "cost", denominator: "leads", ambiguous: 1 },
  { key: "cost_per_appointment", label: "Cost per appointment", formula: "cost / appointments booked", numerator: "cost", denominator: "appointments booked", ambiguous: 1 },
  {
    key: "show_rate",
    label: "Show rate",
    formula: "appointments sat / appointments expected to occur",
    numerator: "appointments with status sat",
    denominator: "appointments in the period with status sat, no-show, or cancelled",
    ambiguous: 0,
  },
  {
    key: "booking_rate",
    label: "Booking rate",
    formula: "appointments booked / a denominator the business defines",
    numerator: "appointments booked",
    denominator: "not defined for this business",
    ambiguous: 1,
  },
  {
    key: "contact_rate",
    label: "Contact rate",
    formula: "contacts / a denominator the business defines",
    numerator: "contacts",
    denominator: "not defined for this business",
    ambiguous: 1,
  },
  {
    key: "close_rate",
    label: "Close rate",
    formula: "sales / a denominator the business defines",
    numerator: "sales",
    denominator: "not defined for this business",
    ambiguous: 1,
  },
  { key: "lead_to_appointment", label: "Lead to appointment rate", formula: "appointments booked / leads", numerator: "appointments", denominator: "leads", ambiguous: 1 },
  { key: "appointment_to_sale", label: "Appointment to sale rate", formula: "sales / appointments sat", numerator: "sales", denominator: "appointments sat", ambiguous: 1 },
  { key: "follow_up_completion", label: "Follow-up completion", formula: "completed follow-ups / expected follow-ups", numerator: "completed", denominator: "expected", ambiguous: 1 },
  { key: "stale_leads", label: "Stale leads", formula: "Leads past the stored callback or untouched past the stored expectation", numerator: "stale leads", denominator: "none", ambiguous: 0 },
  { key: "call_attempts", label: "Call attempts", formula: "Count of stored dial activities", numerator: "dials", denominator: "none", ambiguous: 0 },
] as const;

export type KpiDefinition = {
  id: string;
  organisation_id: string | null;
  kpi_key: string;
  label: string;
  formula: string;
  numerator: string;
  denominator: string;
  ambiguous: number;
  status: string;
};

export function definitionFor(db: Database.Database, organisationId: string, kpiKey: string) {
  return db
    .prepare(`SELECT * FROM ops_kpi_definitions WHERE organisation_id = ? AND kpi_key = ?`)
    .get(organisationId, kpiKey) as KpiDefinition | undefined;
}

export function confirmKpi(db: Database.Database, organisationId: string, kpiKey: string, confirmedBy = "hayden") {
  const template = KPI_CATALOG.find((item) => item.key === kpiKey);
  if (!template) throw new Error("That KPI is not in the catalogue.");
  if (template.ambiguous) throw new Error(`${template.label} still needs a denominator for this business. It has not been stored.`);
  const now = new Date().toISOString();
  const existing = definitionFor(db, organisationId, kpiKey);
  if (existing) {
    db.prepare(`UPDATE ops_kpi_definitions SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?`).run(confirmedBy, now, existing.id);
    return existing.id;
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ops_kpi_definitions (
      id, organisation_id, kpi_key, label, formula, numerator, denominator, ambiguous, status, confirmed_by, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
  ).run(id, organisationId, template.key, template.label, template.formula, template.numerator, template.denominator, template.ambiguous, confirmedBy, now);
  return id;
}

export function setTarget(
  db: Database.Database,
  input: { organisationId: string; kpiKey: string; scopeType: string; scopeLabel: string; periodLabel: string; targetValue: number; targetUnit: string; sourceName: string },
) {
  if (!input.sourceName.trim()) throw new Error("A target needs a source. Hayden OS will not invent one.");
  if (!Number.isFinite(input.targetValue)) throw new Error("That target is not a number.");
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ops_kpi_targets (
      id, organisation_id, kpi_key, scope_type, scope_label, period_label, target_value, target_unit, source_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.organisationId, input.kpiKey, input.scopeType, input.scopeLabel.trim(), input.periodLabel.trim(), input.targetValue, input.targetUnit, input.sourceName.trim(), new Date().toISOString());
  return id;
}

export function targetFor(db: Database.Database, organisationId: string, kpiKey: string, scopeLabel?: string) {
  if (scopeLabel) {
    return db
      .prepare(`SELECT * FROM ops_kpi_targets WHERE organisation_id = ? AND kpi_key = ? AND scope_label = ? ORDER BY created_at DESC LIMIT 1`)
      .get(organisationId, kpiKey, scopeLabel) as { target_value: number; target_unit: string; source_name: string; scope_label: string } | undefined;
  }
  return db
    .prepare(`SELECT * FROM ops_kpi_targets WHERE organisation_id = ? AND kpi_key = ? AND scope_type = 'organisation' ORDER BY created_at DESC LIMIT 1`)
    .get(organisationId, kpiKey) as { target_value: number; target_unit: string; source_name: string; scope_label: string } | undefined;
}
