import type Database from "better-sqlite3";
import { readSecret } from "@/lib/integrations/connections";
import type { AircallSecret } from "@/lib/integrations/aircall/sync";
import { signalsFromUtterances, speakerLabel, type Utterance } from "@/lib/ops/signals";

export function rebuildStoredSignals(db: Database.Database) {
  db.prepare(`DELETE FROM ops_signals`).run();
  const rows = db.prepare(`SELECT t.organisation_id, t.call_external_id, t.lead_id, t.utterances, a.occurred_at FROM ops_transcripts t LEFT JOIN ops_activities a ON a.external_source = 'aircall' AND a.external_id = t.call_external_id WHERE t.status = 'available'`).all() as Array<{ organisation_id: string; call_external_id: string; lead_id: string | null; utterances: string; occurred_at: string | null }>;
  for (const row of rows) {
    storeSignals(db, { external_id: row.call_external_id, organisation_id: row.organisation_id, lead_id: row.lead_id, occurred_at: row.occurred_at }, JSON.parse(row.utterances) as Utterance[]);
  }
}

export async function fetchPendingTranscripts(db: Database.Database, limit = 25) {
  const secret = readSecret<AircallSecret>(db, "aircall");
  if (!secret) throw new Error("Aircall is not connected.");
  const calls = db.prepare(
    `SELECT external_id, organisation_id, lead_id, actor_name, occurred_at
     FROM ops_activities
     WHERE external_source = 'aircall' AND outcome LIKE '%answered%'
       AND NOT EXISTS (SELECT 1 FROM ops_transcripts t WHERE t.call_external_id = ops_activities.external_id)
     ORDER BY CASE WHEN actor_name LIKE '%Josh%' THEN 0 ELSE 1 END, occurred_at DESC
     LIMIT ?`,
  ).all(limit) as Array<{ external_id: string; organisation_id: string; lead_id: string | null; actor_name: string | null; occurred_at: string | null }>;
  let available = 0;
  let missing = 0;
  for (const call of calls) {
    const result = await transcript(secret, call.external_id, call.actor_name);
    const now = new Date().toISOString();
    if (result.kind !== "ok") {
      db.prepare(`INSERT INTO ops_transcripts (id, organisation_id, call_external_id, lead_id, status, utterances, fetched_at) VALUES (?, ?, ?, ?, 'missing', NULL, ?)`).run(crypto.randomUUID(), call.organisation_id, call.external_id, call.lead_id, now);
      missing += 1;
      continue;
    }
    db.prepare(`INSERT INTO ops_transcripts (id, organisation_id, call_external_id, lead_id, status, utterances, fetched_at) VALUES (?, ?, ?, ?, 'available', ?, ?)`).run(crypto.randomUUID(), call.organisation_id, call.external_id, call.lead_id, JSON.stringify(result.utterances), now);
    storeSignals(db, call, result.utterances);
    available += 1;
  }
  return { available, missing, checked: calls.length };
}

function storeSignals(db: Database.Database, call: { external_id: string; organisation_id: string; lead_id: string | null; occurred_at: string | null }, utterances: Utterance[]) {
  const appointment = call.lead_id
    ? (db.prepare(`SELECT id FROM ops_appointments WHERE lead_id = ? ORDER BY scheduled_at DESC LIMIT 1`).get(call.lead_id) as { id: string } | undefined)
    : undefined;
  const insert = db.prepare(
    `INSERT INTO ops_signals (id, organisation_id, lead_id, call_external_id, signal_type, speaker, evidence, occurred_at, confidence, appointment_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const signal of signalsFromUtterances(utterances)) {
    const existing = db.prepare(`SELECT id FROM ops_signals WHERE call_external_id = ? AND signal_type = ? AND evidence = ?`).get(call.external_id, signal.signalType, signal.evidence) as { id: string } | undefined;
    if (existing) continue;
    insert.run(crypto.randomUUID(), call.organisation_id, call.lead_id, call.external_id, signal.signalType, signal.speaker, signal.evidence, call.occurred_at, signal.confidence, appointment?.id ?? null);
  }
}

export async function storedOrFetchTranscript(
  db: Database.Database,
  call: { external_id: string; organisation_id: string; lead_id: string | null; actor_name: string | null },
): Promise<{ status: "available" | "missing" | "failed"; utterances: Utterance[] }> {
  const existing = db.prepare(`SELECT status, utterances FROM ops_transcripts WHERE call_external_id = ?`).get(call.external_id) as { status: string; utterances: string | null } | undefined;
  if (existing?.status === "available" && existing.utterances) return { status: "available", utterances: JSON.parse(existing.utterances) as Utterance[] };
  if (existing?.status === "missing") return { status: "missing", utterances: [] };
  const secret = readSecret<AircallSecret>(db, "aircall");
  if (!secret) return { status: "failed", utterances: [] };
  const result = await transcript(secret, call.external_id, call.actor_name);
  const now = new Date().toISOString();
  if (result.kind === "missing") {
    db.prepare(
      `INSERT INTO ops_transcripts (id, organisation_id, call_external_id, lead_id, status, utterances, fetched_at) VALUES (?, ?, ?, ?, 'missing', NULL, ?)
       ON CONFLICT(call_external_id) DO UPDATE SET status = 'missing', fetched_at = excluded.fetched_at`,
    ).run(crypto.randomUUID(), call.organisation_id, call.external_id, call.lead_id, now);
    return { status: "missing", utterances: [] };
  }
  if (result.kind !== "ok") return { status: "failed", utterances: [] };
  db.prepare(
    `INSERT INTO ops_transcripts (id, organisation_id, call_external_id, lead_id, status, utterances, fetched_at) VALUES (?, ?, ?, ?, 'available', ?, ?)
     ON CONFLICT(call_external_id) DO UPDATE SET status = 'available', utterances = excluded.utterances, fetched_at = excluded.fetched_at`,
  ).run(crypto.randomUUID(), call.organisation_id, call.external_id, call.lead_id, JSON.stringify(result.utterances), now);
  return { status: "available", utterances: result.utterances };
}

async function transcript(secret: AircallSecret, callId: string, agentName: string | null, attempt = 0): Promise<{ kind: "ok" | "missing" | "failed"; utterances: Utterance[] }> {
  const encoded = Buffer.from(`${secret.apiId}:${secret.apiToken}`).toString("base64");
  try {
    const response = await fetch(`https://api.aircall.io/v1/calls/${callId}/transcription`, { headers: { Authorization: `Basic ${encoded}`, Accept: "application/json" } });
    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return transcript(secret, callId, agentName, attempt + 1);
    }
    if (response.status === 404) return { kind: "missing", utterances: [] };
    if (!response.ok) return { kind: "failed", utterances: [] };
    const body = (await response.json()) as { transcription?: { content?: { utterances?: Array<{ text?: string; participant_type?: string; user_id?: number }> } } };
    const utterances = (body.transcription?.content?.utterances ?? [])
      .filter((item) => item.text?.trim())
      .map((item) => ({ speaker: speakerLabel(item.participant_type, agentName), text: item.text!.trim() }));
    return { kind: "ok", utterances };
  } catch {
    return { kind: "failed", utterances: [] };
  }
}
