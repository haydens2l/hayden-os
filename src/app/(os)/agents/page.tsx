import type { Metadata } from "next";
import Link from "next/link";
import { HowLink } from "@/components/shell/how-link";
import { assignToAgent } from "@/lib/actions";
import { formatStamp } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { suggestAgent } from "@/lib/team/route";
import { teamBoard, usageTotals } from "@/lib/team/work";

export const metadata: Metadata = { title: "AI Team" };

const ASSIGNABLE = ["creative", "growth", "media", "content"];

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const { draft } = await searchParams;
  const text = draft?.trim() ?? "";
  const suggestion = text ? suggestAgent(text) : null;
  const db = getDb();
  const seats = teamBoard(db);
  const usage = usageTotals(db);

  return (
    <>
      <header className="page-header">
        <p className="kicker">Agents</p>
        <h1>AI Team</h1>
        <p className="lede">
          Hayden, then the Chief of Staff, then the specialists.           They share one Business brain. They can think and propose. They cannot publish, send, or spend.
        </p>
        <HowLink href="/help#team" />
      </header>
      <section className="section">
        <p className="kicker">Assign to AI</p>
        <form className="command-form" action="/agents" method="get">
          <label className="sr-only" htmlFor="draft">
            Assign to AI
          </label>
          <input id="draft" name="draft" defaultValue={text} placeholder="Come up with five Brisbane Collective series ideas." />
        </form>
        {suggestion ? (
          <form action={assignToAgent} className="row-actions">
            <input type="hidden" name="objective" value={text} />
            <input type="hidden" name="requestedBy" value="hayden" />
            <input type="hidden" name="next" value="/agents" />
            <p>
              Suggested: {suggestion.name}. {suggestion.reason}
            </p>
            <select name="agentId" className="delegate-select" defaultValue={ASSIGNABLE.includes(suggestion.id) ? suggestion.id : "media"}>
              {seats
                .filter((seat) => ASSIGNABLE.includes(seat.id))
                .map((seat) => (
                  <option key={seat.id} value={seat.id}>
                    {seat.name}
                  </option>
                ))}
            </select>
            <button className="text-button" type="submit">
              Assign
            </button>
          </form>
        ) : null}
      </section>
      <p className="quiet">
        AI usage today: {usage.today.input} in / {usage.today.output} out across {usage.today.runs} runs. This month: {usage.month.input} in / {usage.month.output} out.
        Dollar cost is not priced.
      </p>
      <div className="agent-grid">
        {seats.map((seat) => (
          <Link href={`/agents/${seat.id}`} className="card" key={seat.id}>
            <div className="card-top">
              <span className="kicker">{seat.seat}</span>
              <span className="status status-watch">{seat.seat === "NOT BUILT" ? "Not built" : "Active"}</span>
            </div>
            <h3>{seat.name}</h3>
            <p>{seat.role}</p>
            <p>
              <span className="label">Current assignment </span>
              {seat.assignment}
            </p>
            <p>
              <span className="label">Last run </span>
              {formatStamp(seat.lastRun)}
            </p>
            <p>
              <span className="label">Latest finding </span>
              {seat.finding}
            </p>
            <p>
              <span className="label">Waiting on </span>
              {seat.waitingOn}
            </p>
            <p>
              <span className="label">Run cost </span>
              {seat.runCost}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
