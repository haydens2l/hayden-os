import Link from "next/link";
import { generateBrief, saveBriefFeedbackAction } from "@/lib/actions";
import { DataMark } from "@/components/ui/data-mark";
import { formatStamp } from "@/lib/dates";
import type { StoredBrief, StoredFeedback } from "@/lib/chief/persist";
import type { MorningBrief, Recommendation } from "@/lib/chief/types";

const VERDICTS: Array<[string, string]> = [
  ["useful", "Useful"],
  ["not_useful", "Not useful"],
  ["wrong", "Wrong"],
  ["already_handled", "Already handled"],
  ["should_have_been_delegated", "Should have been delegated"],
  ["seen_earlier", "I should have seen this earlier"],
];

export function MorningBriefView({
  brief,
  feedback,
  previous,
  currentId,
  connected,
  modelLabel,
}: {
  brief: StoredBrief;
  feedback: StoredFeedback[];
  previous: StoredBrief[];
  currentId: string;
  connected: boolean;
  modelLabel: string | null;
}) {
  const parsed = parseBrief(brief.brief_json);
  const viewingCurrent = brief.id === currentId;

  return (
    <>
      <section className="section">
        <p className="kicker">The 30-second version</p>
        <p className="why">{parsed.headline}</p>
        <p className="quiet">
          {formatStamp(brief.generated_at)}
          {connected && modelLabel ? ` · ${modelLabel}` : " · Operating rules on stored records"}
          {viewingCurrent ? "" : " · Previous brief"}
        </p>
        {parsed.stale.map((item) => (
          <p className="why" key={item.label}>
            {item.detail}
          </p>
        ))}
      </section>

      <section className="section">
        <p className="kicker">Your three moves</p>
        <h2>{parsed.moves.length === 0 ? "Nothing needs you" : `${parsed.moves.length} for you`}</h2>
        {parsed.moves.length === 0 ? <p className="quiet">Nothing stored needs you today.</p> : null}
        <div className="stack">
          {parsed.moves.map((move) => (
            <MoveCard key={move.id} move={move} briefId={brief.id} />
          ))}
        </div>
      </section>

      <section className="section">
        <p className="kicker">What changed</p>
        {parsed.changed.map((line) => (
          <p className="why" key={line}>
            {line}
          </p>
        ))}
      </section>

      <section className="section">
        <p className="kicker">Being handled</p>
        {parsed.handled.length === 0 ? (
          <p className="quiet">Nothing meaningful is stored with other people.</p>
        ) : (
          <div className="stack">
            {parsed.handled.map((line) => (
              <p className="why" key={`${line.who}-${line.what}`}>
                {line.who} — {line.what} — {line.note}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <p className="kicker">Watching</p>
        {parsed.watching.length === 0 ? (
          <p className="quiet">Nothing else is worth watching.</p>
        ) : (
          parsed.watching.map((line) => (
            <article className="record" key={line.id}>
              <p>{line.text}</p>
              <FeedbackForm briefId={brief.id} recommendationId={line.id} />
            </article>
          ))
        )}
      </section>

      <section className="section">
        <p className="kicker">Decisions</p>
        {parsed.decisions.length === 0 ? (
          <p className="quiet">No founder decision is waiting.</p>
        ) : (
          <div className="stack">
            {parsed.decisions.map((item) => (
              <article className="record" key={item.id}>
                <h3>{item.title}</h3>
                <p>{item.business}</p>
                {parsed.moves.some((move) => move.id === item.id) ? null : <p className="quiet">Outside today&apos;s three.</p>}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <p className="kicker">Opportunities</p>
        {parsed.opportunities.length === 0 ? (
          <p className="quiet">No meaningful opportunity is stored.</p>
        ) : (
          <div className="stack">
            {parsed.opportunities.map((item) => (
              <article className="record" key={item.id}>
                <h3>{item.title}</h3>
                <p>{item.why}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <p className="kicker">What I would ignore today</p>
        {parsed.ignore.length === 0 ? (
          <p className="quiet">No operational cluster is crowding the day.</p>
        ) : (
          <div className="stack">
            {parsed.ignore.map((item) => (
              <article className="record" key={item.id}>
                <h3>{item.what}</h3>
                <p>{item.why}</p>
                <FeedbackForm briefId={brief.id} recommendationId={item.id} />
              </article>
            ))}
          </div>
        )}
      </section>

      {parsed.bottlenecks.length > 0 ? (
        <section className="section">
          <p className="kicker">Founder bottlenecks</p>
          {parsed.bottlenecks.map((line) => (
            <p className="why" key={line}>
              {line}
            </p>
          ))}
        </section>
      ) : null}

      {feedback.length > 0 ? (
        <section className="section">
          <p className="kicker">Pending memory review</p>
          <div className="stack">
            {feedback.map((item) => (
              <article className="record" key={item.id}>
                <p className="kicker">Pending memory review</p>
                <h3>{labelVerdict(item.verdict)}</h3>
                {item.comment ? <p>{item.comment}</p> : null}
              </article>
            ))}
          </div>
          <p className="quiet">A comment stays here until you review it. It does not change Business Brain strategy.</p>
        </section>
      ) : null}

      <section className="section">
        <p className="kicker">Previous briefs</p>
        <div className="stack">
          {previous.map((item) => (
            <p key={item.id}>
              <Link href={item.id === currentId ? "/today" : `/today?brief=${item.id}`}>
                {formatStamp(item.generated_at)} — {parseBrief(item.brief_json).headline}
              </Link>
              {item.id === currentId ? " · Current brief" : ""}
            </p>
          ))}
        </div>
      </section>
    </>
  );
}

export function GenerateBrief() {
  return (
    <form action={generateBrief}>
      <button className="text-button" type="submit">
        Generate brief
      </button>
    </form>
  );
}

function MoveCard({ move, briefId }: { move: Recommendation; briefId: string }) {
  const href = move.entityType === "decision" ? `/decisions/${move.id}` : move.entityType === "task" ? `/today/${move.id}` : null;
  return (
    <article className="record">
      <p className="kicker">
        {move.business ?? "No business"} <DataMark status={move.dataStatus} />
      </p>
      <h3>{href ? <Link href={href}>{move.action}</Link> : move.action}</h3>
      <p>{move.why}</p>
      <p className="quiet">Expected outcome: {move.expectedOutcome}</p>
      <p className="quiet">Estimated Hayden time: {move.haydenTime}</p>
      <p className="quiet">Next: {move.nextStep}</p>
      <p className="quiet">
        {move.recommendedOwnerName ?? "No owner"} — {move.ownerReason}
        {move.suggestedDeadline ? ` Deadline ${move.suggestedDeadline}.` : " No deadline is stored."}
      </p>
      <details>
        <summary>Why?</summary>
        <p className="why">Evidence</p>
        <ul>
          {move.evidence.map((item) => (
            <li key={`${item.type}-${item.id}`}>
              {item.type}: {item.label}
            </li>
          ))}
        </ul>
        <p className="why">Business Brain</p>
        <ul>
          {move.brain.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="why">{move.reachedHaydenBecause}</p>
        <p className="quiet">Confidence: {move.confidence}.</p>
        {move.changeReason ? (
          <p className="quiet">
            Stored classification {move.originalClassification}. Chief recommendation {move.recommendedClassification}. {move.changeReason}
          </p>
        ) : null}
      </details>
      <FeedbackForm briefId={briefId} recommendationId={move.id} />
    </article>
  );
}

function FeedbackForm({ briefId, recommendationId }: { briefId: string; recommendationId: string }) {
  return (
    <form action={saveBriefFeedbackAction} className="row-actions">
      <input type="hidden" name="briefId" value={briefId} />
      <input type="hidden" name="recommendationId" value={recommendationId} />
      <select name="verdict" className="delegate-select" defaultValue="useful">
        {VERDICTS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <input className="tiny-input" name="comment" placeholder="Optional comment" />
      <button className="text-button" type="submit">
        Save feedback
      </button>
    </form>
  );
}

function parseBrief(raw: string): MorningBrief {
  return JSON.parse(raw) as MorningBrief;
}

function labelVerdict(verdict: string) {
  return VERDICTS.find(([value]) => value === verdict)?.[1] ?? verdict;
}
