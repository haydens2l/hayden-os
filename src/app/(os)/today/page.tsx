import type { Metadata } from "next";
import Link from "next/link";
import { HowLink } from "@/components/shell/how-link";
import { AttentionList } from "@/components/today/attention-list";
import { GenerateBrief, MorningBriefView } from "@/components/today/morning-brief";
import { DataMark } from "@/components/ui/data-mark";
import { providerStatus } from "@/lib/ai/provider";
import { getBrief, listBriefs, listFeedback } from "@/lib/chief/persist";
import { getDb } from "@/lib/db/client";
import { listAssignees, loadToday } from "@/lib/db/repository";
import { attentionWindow } from "@/lib/priority/engine";
import { reviewQueue } from "@/lib/work/state";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ all?: string; brief?: string }> }) {
  const { all, brief: briefId } = await searchParams;
  const expanded = all === "1";
  const board = loadToday();
  const shown = attentionWindow(board.attention, expanded);
  const assignees = listAssignees();
  const hidden = board.attention.length - shown.length;
  const status = providerStatus();
  const db = getDb();
  const briefs = listBriefs(db);
  const current = briefs[0];
  const selected = (briefId ? getBrief(db, briefId) : current) ?? current;
  const feedback = selected ? listFeedback(db, selected.id) : [];
  const reviews = reviewQueue(db);

  return (
    <>
      <header className="page-header morning">
        <p className="kicker">Today</p>
        <h1>Good morning Hayden</h1>
        <HowLink href="/help#today" />
      </header>

      {status.connected ? null : (
        <section className="section">
          <h2>AI Chief of Staff not connected</h2>
          <p className="why">
            Set AI_PROVIDER, AI_MODEL, and AI_API_KEY in the server environment file `.env` in this project, then restart. Supported providers are xai, openai, and anthropic. The key stays on the server.
          </p>
        </section>
      )}

      <section className="section">
        <GenerateBrief />
        <p className="quiet">A refresh does not write a new brief.</p>
      </section>

      {selected ? (
        <MorningBriefView
          brief={selected}
          feedback={feedback}
          previous={briefs}
          currentId={current?.id ?? selected.id}
          connected={status.connected}
          modelLabel={status.connected && status.provider && status.model ? `${status.provider} / ${status.model}` : null}
        />
      ) : (
        <section className="section">
          <p className="kicker">The 30-second version</p>
          <p className="why">No brief is stored yet.</p>
        </section>
      )}

      <section className="section">
        <p className="kicker">Needs your review</p>
        {reviews.length === 0 ? <p className="quiet">Nothing is waiting for review.</p> : null}
        {reviews.map((row) => (
          <p key={row.id}>
            {row.organisation ?? "Unassigned"} — {row.title}. {row.ownerName ?? "Someone"} submitted.{" "}
            <Link href={row.href}>Review</Link>
          </p>
        ))}
      </section>

      <section className="section">
        <p className="kicker">Records</p>
        <h2>{shown.length === 0 ? "Nothing needs you" : `${shown.length} for you`}</h2>
        <AttentionList items={shown} assignees={assignees} next={expanded ? "/today?all=1" : "/today"} mode="act" />
        {hidden > 0 ? (
          <p className="quiet">
            <Link href="/today?all=1">Show {Math.min(5, board.attention.length)}</Link>
          </p>
        ) : null}
        {expanded && board.attention.length > 3 ? (
          <p className="quiet">
            <Link href="/today">Show three</Link>
          </p>
        ) : null}
        {board.attention.length > 5 ? <p className="quiet">The rest stays off this screen.</p> : null}
      </section>

      <section className="section">
        <p className="kicker">Delegated</p>
        <h2>With someone else</h2>
        <AttentionList items={board.delegated} assignees={assignees} next="/today" mode="quiet" />
      </section>

      <section className="section">
        <p className="kicker">Watching</p>
        <h2>Not yet</h2>
        <AttentionList items={board.watching} assignees={assignees} next="/today" mode="quiet" />
      </section>

      <section className="section">
        <p className="kicker">Completed today</p>
        <h2>Done</h2>
        {board.completed.length === 0 ? (
          <p className="quiet">Nothing completed today.</p>
        ) : (
          <ol className="priorities">
            {board.completed.map((item) => (
              <li className="priority" key={`${item.entityType}-${item.id}`}>
                <span className="priority-index">✓</span>
                <div>
                  <p className="kicker">{item.organisationName ?? "No business"}</p>
                  <h3>{item.title}</h3>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="section">
        <p className="kicker">Inbox</p>
        <h2>Captured</h2>
        {board.inbox.length === 0 ? (
          <p className="quiet">Nothing captured.</p>
        ) : (
          <div className="stack">
            {board.inbox.map((item) => (
              <div className="record" key={item.id}>
                <p className="kicker">
                  {item.kind} <DataMark status={item.dataStatus} />
                </p>
                <h3>{item.rawText}</h3>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
