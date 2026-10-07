import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Call evidence" };

function excerpt(lines: Array<{ speaker: string; text: string }>, signals: Array<{ signal_type: string; evidence: string }>) {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (!signals.some((signal) => signal.evidence === line.text)) return;
    keep.add(index);
    if (index > 0) keep.add(index - 1);
  });
  return [...keep].sort((a, b) => a - b).map((index) => {
    const signal = signals.find((item) => item.evidence === lines[index].text);
    return { index, ...lines[index], signal: signal?.signal_type ?? "" };
  });
}

export default async function CallEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const call = db.prepare(`SELECT actor_name, occurred_at, outcome, source_url, lead_id FROM ops_activities WHERE external_source = 'aircall' AND external_id = ?`).get(id) as { actor_name: string | null; occurred_at: string | null; outcome: string | null; source_url: string | null; lead_id: string | null } | undefined;
  const transcript = db.prepare(`SELECT status, utterances FROM ops_transcripts WHERE call_external_id = ?`).get(id) as { status: string; utterances: string | null } | undefined;
  if (!call && !transcript) notFound();
  const lines = transcript?.utterances ? (JSON.parse(transcript.utterances) as Array<{ speaker: string; text: string }>) : [];
  const signals = db.prepare(`SELECT signal_type, evidence FROM ops_signals WHERE call_external_id = ?`).all(id) as Array<{ signal_type: string; evidence: string }>;
  return (
    <>
      <header className="page-header">
        <p className="kicker">Call evidence</p>
        <h1>{call?.actor_name || "Call"} {call?.occurred_at?.slice(0, 16).replace("T", " ")}</h1>
      </header>
      <p>{call?.outcome}</p>
      <p>Transcript: {transcript?.status || "not read"}.</p>
      {call?.source_url ? <p><a href={call.source_url}>Open the Aircall record</a></p> : null}
      {signals.map((signal) => (
        <p key={`${signal.signal_type}-${signal.evidence.slice(0, 24)}`}>Signal: {signal.signal_type}</p>
      ))}
      <section className="section">
        <h2>Exact words</h2>
        {excerpt(lines, signals).map((line) => (
          <p key={`${line.index}-${line.text.slice(0, 12)}`}><strong>{line.speaker}:</strong> "{line.text}"{line.signal ? ` · ${line.signal}` : ""}</p>
        ))}
        {lines.length && !signals.length ? <p>No operational signal was found in this transcript.</p> : null}
        {!lines.length ? <p>No transcript text is stored for this call.</p> : null}
      </section>
      {call?.lead_id ? <p><Link href={`/operations/lead/${call.lead_id}`}>Back to the lead</Link></p> : <p><Link href="/operations/audit">Back to the audit</Link></p>}
    </>
  );
}
