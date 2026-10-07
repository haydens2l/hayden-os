import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { providerSetup, providerStatus } from "@/lib/ai/provider";
import { databaseFile, listIntegrations } from "@/lib/db/repository";

export const metadata: Metadata = { title: "Settings" };

function connectionHref(id: string) {
  if (id === "google-drive" || id === "aircall" || id === "gohighlevel") return `/settings/integrations/${id}`;
  return null;
}

export default function SettingsPage() {
  const integrations = listIntegrations();
  const chief = providerStatus();
  const setup = providerSetup();
  return (
    <>
      <PageHeader
        kicker="System"
        title="Settings"
        lede="Today uses the priority score, the attention filter, and a Chief of Staff brief. Aircall and GoHighLevel can be connected as read-only. Other live connections stay off."
      />
      <section className="section">
        <h2>{chief.connected ? "Chief of Staff" : "AI Chief of Staff not connected"}</h2>
        {chief.connected ? (
          <p className="why">
            Connected through {chief.provider} / {chief.model}. The key stays on the server and is not shown here.
          </p>
        ) : (
          <>
            <p className="why">
              Put {setup.variables.join(", ")} in the server environment file `{setup.file}` in this project, then restart. AI_PROVIDER is {setup.providers}. AI_MODEL is the model name from that provider. AI_API_KEY is the secret. Do not hard-code a key.
            </p>
            <p className="quiet">Generate brief still runs from stored records until a provider is set. The key is never sent to the browser.</p>
          </>
        )}
      </section>
      <section className="section">
        <h2>Memory</h2>
        <p className="why">Database file: {databaseFile()}</p>
        <p className="quiet">
          Delete that file and the next launch writes a fresh snapshot. Organisations are records. Archive a status and the pulse drops it. Do not hard-wire brand names into new logic.
        </p>
      </section>
      <section className="section">
        <h2>Connections</h2>
        <div className="stack">
          {integrations.map((integration) => (
            <div key={integration.id} className="record">
                <h3>{connectionHref(integration.id) ? <Link href={connectionHref(integration.id)!}>{integration.name}</Link> : integration.name}</h3>
              <p>
                {integration.status}. {integration.notes}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className="section">
        <h2>What stays off Hayden</h2>
        <p className="quiet">
          CRM cleanup, chasing, formatting, routine research, content production, reminders, data entry and standard follow-up. Agents will need an explicit permission before they can read, create, update, execute or escalate. Spending, launching, mass outreach, deleting, changing financials and publishing stay behind approval.
        </p>
      </section>
    </>
  );
}
