import type { Metadata } from "next";
import Link from "next/link";
import { approveDriveFolder, disconnectDriveNow, removeDriveFolder, syncDriveNow } from "@/lib/actions";
import { getDb } from "@/lib/db/client";
import { redirectUri } from "@/lib/integrations/google-drive/crypto";
import { listChildFolders, listRootFolders } from "@/lib/integrations/google-drive/google";
import { connectionStatus, listSources } from "@/lib/integrations/google-drive/store";
import { formatStamp } from "@/lib/dates";

export const metadata: Metadata = { title: "Google Drive" };

const ERRORS: Record<string, string> = {
  missing_client: "Google Drive is not configured yet.",
  state: "The Google sign-in could not be confirmed. Try Connect again.",
  exchange: "Google Drive connection failed.",
};

export default async function GoogleDrivePage({ searchParams }: { searchParams: Promise<{ error?: string; parent?: string }> }) {
  const { error, parent } = await searchParams;
  const db = getDb();
  const status = connectionStatus(db);
  const sources = listSources(db);
  const folders = status.status === "connected" ? await safeFolders(db, parent) : [];

  return (
    <>
      <header className="page-header">
        <p className="kicker">Integrations</p>
        <h1>Google Drive</h1>
      </header>
      <section className="section">
        <p className="kicker">Status</p>
        <h2>{labelStatus(status.status)}</h2>
        <p className="why">Connected account: {status.accountEmail ?? "None"}</p>
        <p className="quiet">Last sync: {status.lastSync ? formatStamp(status.lastSync) : "Never"}</p>
        <p className="quiet">Files indexed: {status.filesIndexed}</p>
        <p className="quiet">Folders indexed: {status.foldersIndexed}</p>
        <p className="quiet">Scope: {status.scope}</p>
        {status.lastError ? <p className="why">{status.lastError}</p> : null}
        {error && ERRORS[error] ? <p className="why">{ERRORS[error]}</p> : null}
      </section>

      {status.configured ? null : (
        <section className="section">
          <h2>What to add on the server</h2>
          <p className="why">
            Create a Google Cloud OAuth web client, enable the Drive API, and put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server file `.env`. Set the authorised redirect URI to {redirectUri()}. Add a long random DRIVE_TOKEN_KEY in the same file. Restart Hayden OS. Do not paste a refresh token into the page.
          </p>
        </section>
      )}

      <section className="section">
        {status.status === "connected" ? (
          <div className="row-actions">
            <form action={syncDriveNow}>
              <button className="text-button" type="submit">
                Sync now
              </button>
            </form>
            <form action={disconnectDriveNow}>
              <button className="text-button" type="submit">
                Disconnect
              </button>
            </form>
            <Link href="/intelligence/knowledge">View index</Link>
          </div>
        ) : (
          <p>
            <a href="/api/integrations/google/start">Connect Google Drive</a>
          </p>
        )}
        <p className="quiet">Read only. Hayden OS cannot delete, move, rename, edit, share, or create Drive files.</p>
      </section>

      <section className="section">
        <p className="kicker">Knowledge sources</p>
        <h2>Approved folders</h2>
        {sources.length === 0 ? <p className="quiet">No folder is approved. The rest of Drive stays out of the index.</p> : null}
        <div className="stack">
          {sources.map((source) => (
            <article className="record" key={source.id}>
              <h3>{source.name}</h3>
              <p>{source.path ?? source.drive_folder_id}</p>
              <form action={removeDriveFolder}>
                <input type="hidden" name="folderId" value={source.drive_folder_id} />
                <button className="text-button" type="submit">
                  Remove
                </button>
              </form>
            </article>
          ))}
        </div>
      </section>

      {status.status === "connected" ? (
        <section className="section">
          <p className="kicker">Drive</p>
          <h2>Choose a folder</h2>
          <p className="quiet">
            {parent ? <Link href="/settings/integrations/google-drive">Back to the top</Link> : "These are the real folders Google returned."}
          </p>
          <div className="stack">
            {folders.map((folder) => (
              <article className="record" key={folder.id}>
                <h3>
                  <Link href={`/settings/integrations/google-drive?parent=${encodeURIComponent(folder.id)}`}>{folder.name}</Link>
                </h3>
                <form action={approveDriveFolder}>
                  <input type="hidden" name="folderId" value={folder.id} />
                  <input type="hidden" name="name" value={folder.name} />
                  <input type="hidden" name="path" value={folder.name} />
                  <button className="text-button" type="submit">
                    Use this folder
                  </button>
                </form>
              </article>
            ))}
            {folders.length === 0 ? <p className="quiet">No folders were returned here.</p> : null}
          </div>
        </section>
      ) : null}
    </>
  );
}

function labelStatus(status: string) {
  if (status === "connected") return "Connected";
  if (status === "error") return "Error";
  return "Disconnected";
}

async function safeFolders(db: ReturnType<typeof getDb>, parent?: string) {
  try {
    return parent ? await listChildFolders(db, parent) : await listRootFolders(db);
  } catch {
    return [];
  }
}
