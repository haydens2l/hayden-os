import type { Metadata } from "next";
import { stageOperationsImport } from "@/lib/actions";
import { PageHeader } from "@/components/ui/page-header";
import { listOrganisations } from "@/lib/db/repository";

export const metadata: Metadata = { title: "Import operations" };

export default function ImportPage() {
  const organisations = listOrganisations();
  return (
    <>
      <PageHeader kicker="Operations" title="Import a CSV" lede="Choose the business, then the file. Nothing is stored until you map the columns and confirm." />
      <form className="brain-form" action={stageOperationsImport}>
        <label>
          Business
          <select name="organisationId">
            {organisations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          CSV
          <input name="file" type="file" accept=".csv,text/csv" required />
        </label>
        <button className="decision-button decision-approve" type="submit">
          Preview
        </button>
      </form>
    </>
  );
}
