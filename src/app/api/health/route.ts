import { getDb } from "@/lib/db/client";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const db = getDb();
    const organisations = db.prepare("SELECT COUNT(*) AS n FROM organisations").get() as { n: number };
    const priorities = db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE requires_hayden = 1 AND status IN ('open', 'in_progress')")
      .get() as { n: number };
    return Response.json({ ok: true, organisations: organisations.n, priorities: priorities.n });
  } catch (error) {
    log.error("health check failed", { error: error instanceof Error ? error.message : String(error) });
    return Response.json({ ok: false }, { status: 500 });
  }
}
