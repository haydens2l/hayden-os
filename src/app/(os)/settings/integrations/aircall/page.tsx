import type { Metadata } from "next";
import Link from "next/link";
import { saveAircallAction, syncAircallAction } from "@/lib/actions";
import { getDb } from "@/lib/db/client";
import { listOrganisations } from "@/lib/db/repository";
import { getConnection } from "@/lib/integrations/connections";
import { formatStamp } from "@/lib/dates";

export const metadata: Metadata = { title: "Aircall" };

export default async function AircallPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const db = getDb();
  const connection = getConnection(db, "aircall");
  const organisations = listOrganisations().filter((item) => item.status === "active");
  return (
    <>
      <header className="page-header">
        <p className="kicker">Integrations</p>
        <h1>Aircall</h1>
      </header>
      <section className="section">
        <p className="why">Read-only. Hayden OS pulls calls. It does not place calls, add notes, or change anything in Aircall.</p>
        <p className="quiet">Status: {connection.status}. {connection.hasSecret ? "The API token is stored and is not shown." : "No API token is stored."}</p>
        <p className="quiet">Business: {organisations.find((item) => item.id === connection.organisationId)?.name ?? "Not chosen"}</p>
        <p className="quiet">Last pull: {connection.lastSyncAt ? formatStamp(connection.lastSyncAt) : "Never"}</p>
        {connection.lastSummary ? <p className="why">{connection.lastSummary}</p> : null}
        {connection.lastError ? <p className="why">{connection.lastError}</p> : null}
        {notice ? <p className="why">{notice}</p> : null}
        <p className="quiet">Create the key in Aircall under Integrations, then API keys. Calls are filed by the line name. FIFO Investor lines go to FIFO Investor. IWG lines go to Inception Wealth Group. Any other line is skipped. A call is stored as a call. It is not treated as a transcript, a show, or a sale.</p>
      </section>
      <section className="section">
        <form action={saveAircallAction} className="stack">
          <label>
            Business
            <select name="organisationId" defaultValue={connection.organisationId ?? ""} required>
              <option value="">Choose a business</option>
              {organisations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            API ID
            <input name="apiId" autoComplete="off" placeholder={connection.hasSecret ? "Stored. Leave blank to keep it." : ""} />
          </label>
          <label>
            API token
            <input name="apiToken" type="password" autoComplete="off" placeholder={connection.hasSecret ? "Stored. Leave blank to keep it." : ""} />
          </label>
          <button className="decision-button" type="submit">
            Check and save
          </button>
        </form>
      </section>
      <section className="section">
        <form action={syncAircallAction}>
          <button className="decision-button" type="submit" disabled={connection.status !== "connected"}>
            Pull the last 14 days
          </button>
        </form>
        <p className="quiet">
          <Link href="/operations">Back to Operations</Link>
        </p>
      </section>
    </>
  );
}
