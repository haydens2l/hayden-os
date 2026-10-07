import { syncAircall } from "@/lib/integrations/aircall/sync";
import { syncGhl } from "@/lib/integrations/ghl/sync";
import { getDb } from "@/lib/db/client";
import { log } from "@/lib/log";
import { reviewJoshBookings } from "@/lib/ops/booking";
import { linkCallsToLeads } from "@/lib/ops/identity";
import { rebuildNoShows } from "@/lib/ops/noshow";
import { assignPeople } from "@/lib/ops/person";
import { readSyncState, tryLock, unlock, writeSyncState } from "@/lib/ops/sync-state";

const MINUTES = 10;

export function startOpsSync() {
  const state = globalThis as { haydenOpsTimer?: boolean };
  if (state.haydenOpsTimer) return;
  state.haydenOpsTimer = true;
  setTimeout(() => {
    void runOpsSync().catch((error) => log.error("operations sync failed", { error: error instanceof Error ? error.message : "sync failed" }));
  }, 8000);
  setInterval(() => {
    void runOpsSync().catch((error) => log.error("operations sync failed", { error: error instanceof Error ? error.message : "sync failed" }));
  }, MINUTES * 60 * 1000);
}

export async function runOpsSync() {
  const db = getDb();
  if (!tryLock(db)) return "A sync is already running.";
  try {
    let ghl = "GoHighLevel was not connected.";
    let aircall = "Aircall was not connected.";
    let ghlError: string | null = null;
    let aircallError: string | null = null;
    try {
      ghl = await syncGhl(db);
    } catch (error) {
      ghlError = error instanceof Error ? error.message : "GoHighLevel sync failed.";
      ghl = ghlError;
    }
    try {
      aircall = await syncAircall(db);
    } catch (error) {
      aircallError = error instanceof Error ? error.message : "Aircall sync failed.";
      aircall = aircallError;
    }
    assignPeople(db);
    linkCallsToLeads(db);
    const transcripts = await reviewJoshBookings(db);
    const air = readSyncState(db, "aircall");
    writeSyncState(db, { ...air, transcriptsDiscovered: transcripts });
    rebuildNoShows(db);
    return `${ghl} ${aircall} ${transcripts} booking transcripts checked.`;
  } finally {
    unlock(db);
  }
}
