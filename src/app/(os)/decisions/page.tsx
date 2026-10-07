import type { Metadata } from "next";
import { DecisionList } from "@/components/command/decision-list";
import { PageHeader } from "@/components/ui/page-header";
import { formatShortDate } from "@/lib/dates";
import { listAssignees, listDecisions } from "@/lib/db/repository";

export const metadata: Metadata = { title: "Decisions" };

export default function DecisionsPage() {
  const open = listDecisions("open");
  const decided = listDecisions("decided");
  return (
    <>
      <PageHeader
        kicker="Judgement"
        title="Decision queue"
        lede="Calls that need a choice. Ordinary tasks stay off this list."
      />
      <DecisionList decisions={open} assignees={listAssignees()} />
      <section className="section">
        <h2>Already made</h2>
        <div className="stack">
          {decided.map((decision) => (
            <div key={decision.id} className="record">
              <h3>{decision.title}</h3>
              <p>
                {decision.organisation_name} · {formatShortDate(decision.decided_at)}
              </p>
              <p>{decision.decision}</p>
            </div>
          ))}
          {decided.length === 0 ? <p className="quiet">No decisions have been recorded.</p> : null}
        </div>
      </section>
    </>
  );
}
