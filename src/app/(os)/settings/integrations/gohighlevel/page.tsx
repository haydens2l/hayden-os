import type { Metadata } from "next";
import Link from "next/link";
import { saveGhlAction, syncGhlAction } from "@/lib/actions";
import { getDb } from "@/lib/db/client";
import { listOrganisations } from "@/lib/db/repository";
import { getConnection } from "@/lib/integrations/connections";
import { formatStamp } from "@/lib/dates";

export const metadata: Metadata = { title: "GoHighLevel" };

export default async function GoHighLevelPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const db = getDb();
  const connection = getConnection(db, "gohighlevel");
  const organisations = listOrganisations().filter((item) => item.status === "active");
  return (
    <>
      <header className="page-header">
        <p className="kicker">Integrations</p>
        <h1>GoHighLevel</h1>
      </header>
      <section className="section">
        <p className="why">Read-only. Hayden OS pulls the mapped pipelines. It does not create contacts, move stages, or change anything in GoHighLevel.</p>
        <p className="quiet">Status: {connection.status}. {connection.hasSecret ? "The token is stored and is not shown." : "No token is stored."}</p>
        <p className="quiet">Account: {connection.accountLabel ?? "Not checked"}</p>
        <p className="quiet">Business: {organisations.find((item) => item.id === connection.organisationId)?.name ?? "Not chosen"}</p>
        <p className="quiet">Last pull: {connection.lastSyncAt ? formatStamp(connection.lastSyncAt) : "Never"}</p>
        {connection.lastSummary ? <p className="why">{connection.lastSummary}</p> : null}
        {connection.lastError ? <p className="why">{connection.lastError}</p> : null}
        {notice ? <p className="why">{notice}</p> : null}
        <p className="quiet">In the sub-account, create a Private Integration with read access to opportunities and locations. Paste the token and the location ID here. Meta is FIFO Investor tax leak. Paid off home is FIFO Investor paid off. Brisbane Paid off is Inception Wealth Group, for the Brisbane and Gold Coast homeowners. Other pipelines are skipped.</p>
      </section>
      <section className="section">
        <form action={saveGhlAction} className="stack">
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
            Location ID
            <input name="locationId" autoComplete="off" placeholder={connection.hasSecret ? "Stored. Leave blank to keep it." : ""} />
          </label>
          <label>
            Private integration token
            <input name="token" type="password" autoComplete="off" placeholder={connection.hasSecret ? "Stored. Leave blank to keep it." : ""} />
          </label>
          <button className="decision-button" type="submit">
            Check and save
          </button>
        </form>
      </section>
      <section className="section">
        <form action={syncGhlAction}>
          <button className="decision-button" type="submit" disabled={connection.status !== "connected"}>
            Pull the mapped pipelines
          </button>
        </form>
        <p className="quiet">
          <Link href="/operations">Back to Operations</Link>
        </p>
      </section>
    </>
  );
}
