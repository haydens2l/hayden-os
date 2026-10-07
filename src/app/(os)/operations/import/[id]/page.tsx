import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { confirmOperationsImport } from "@/lib/actions";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { parseCsv } from "@/lib/ops/csv";
import { getDraft, previewAppointments, savedMapping } from "@/lib/ops/import";

export const metadata: Metadata = { title: "Map import" };

const FIELDS: Array<[string, string, boolean]> = [
  ["appointment_at", "Appointment date", true],
  ["status", "Status", true],
  ["booked_at", "Booked date", false],
  ["setter", "Setter", false],
  ["name", "Name", false],
  ["phone", "Phone", false],
  ["confirmation", "Confirmation", false],
  ["partner", "Partner uncertain", false],
  ["evidence", "Transcript or note", false],
  ["evidence_type", "Evidence type", false],
  ["rebooking_attempted", "Rebooking attempted", false],
  ["campaign", "Campaign", false],
  ["stage", "Pipeline stage", false],
  ["tags", "Tags", false],
];

export default async function MapImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const draft = getDraft(db, id);
  if (!draft) notFound();
  const headers = parseCsv(draft.csv_text)[0] ?? [];
  const saved = savedMapping(db, draft.organisation_id) ?? {};
  const preview = previewAppointments(draft.csv_text, {
    appointment_at: saved.appointment_at,
    status: saved.status,
  });

  return (
    <>
      <PageHeader kicker={draft.file_name} title="Map the columns" lede="Status and appointment date are required. Rows that cannot be read are rejected and listed." />
      {saved.appointment_at ? <p>{preview.accepted.length} rows can be read with the saved mapping. {preview.rejected.length} would be rejected.</p> : null}
      <form className="brain-form" action={confirmOperationsImport}>
        <input type="hidden" name="draftId" value={draft.id} />
        {FIELDS.map(([name, label, required]) => (
          <label key={name}>
            {label}
            <select name={name} defaultValue={(saved as Record<string, string | undefined>)[name] ?? ""} required={required}>
              <option value="">{required ? "Choose a column" : "Not in this file"}</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button className="decision-button decision-approve" type="submit">
          Import
        </button>
      </form>
    </>
  );
}
