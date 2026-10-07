import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DataMark } from "@/components/ui/data-mark";
import { PageHeader } from "@/components/ui/page-header";
import { deferItem, delegateItem, recordDecision } from "@/lib/actions";
import { formatShortDate } from "@/lib/dates";
import { getDecision, listAssignees } from "@/lib/db/repository";

export const metadata: Metadata = { title: "Decision" };

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decision = getDecision(id);
  if (!decision) notFound();
  const assignees = listAssignees();
  const next = `/decisions/${decision.id}`;

  return (
    <>
      <PageHeader
        kicker={`${decision.organisation_name ?? "Decision"} · ${formatShortDate(decision.deadline)}`}
        title={decision.title}
        lede={decision.context ?? undefined}
      />
      <p className="meta">
        <DataMark status={decision.data_status} />
        <span>Owner {decision.owner_name ?? "Unassigned"}</span>
        <span>Status {decision.status}</span>
      </p>
      {decision.evidence ? <p className="why">Evidence — {decision.evidence}</p> : null}
      {decision.cost_of_delay ? <p className="why">Cost of delay — {decision.cost_of_delay}</p> : null}
      {decision.recommended_option ? <p className="action-line"><span>→</span>{decision.recommended_option}</p> : null}

      {decision.status === "decided" ? (
        <p className="why">Recorded: {decision.decision}</p>
      ) : decision.status === "deferred" ? (
        <p className="quiet">Deferred until {formatShortDate(decision.deadline)}.</p>
      ) : (
        <>
          <form action={recordDecision} className="section">
            <input type="hidden" name="id" value={decision.id} />
            <input type="hidden" name="next" value={next} />
            <p className="kicker">Choose one</p>
            <ul className="choice-list">
              {decision.options.map((option) => (
                <li key={option}>
                  <label>
                    <input type="radio" name="choice" value={option} defaultChecked={option === decision.recommended_option} required />
                    <span>
                      {option}
                      {option === decision.recommended_option ? <span className="recommend">Recommendation</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="row-actions">
              <button className="text-button" type="submit">
                Decide
              </button>
            </div>
          </form>
          <div className="row-actions">
            <form action={delegateItem} className="delegate-form">
              <input type="hidden" name="entity_type" value="decision" />
              <input type="hidden" name="entity_id" value={decision.id} />
              <input type="hidden" name="next" value="/today" />
              <select className="delegate-select" name="assignee" required aria-label="Delegate to">
                {assignees.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input className="tiny-input" type="date" name="deadline" required aria-label="Deadline" />
              <input className="tiny-input outcome" type="text" name="expected_outcome" required placeholder="Expected outcome" />
              <button className="text-button" type="submit">
                Delegate
              </button>
            </form>
            <form action={deferItem}>
              <input type="hidden" name="id" value={decision.id} />
              <input type="hidden" name="next" value="/today" />
              <button className="text-button" type="submit">
                Defer
              </button>
            </form>
          </div>
        </>
      )}
    </>
  );
}
