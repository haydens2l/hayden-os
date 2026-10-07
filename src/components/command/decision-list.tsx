import Link from "next/link";
import { deferItem, delegateItem } from "@/lib/actions";
import { DataMark } from "@/components/ui/data-mark";
import { formatShortDate } from "@/lib/dates";
import type { Decision } from "@/lib/db/types";

export type AssigneeOption = { value: string; label: string };

export function DecisionList({
  decisions,
  assignees = [],
  next = "/decisions",
}: {
  decisions: Decision[];
  assignees?: AssigneeOption[];
  next?: string;
}) {
  if (decisions.length === 0) return <p className="quiet">No decisions are waiting.</p>;
  return (
    <ol className="decisions">
      {decisions.map((decision) => (
        <li key={decision.id} className={decision.data_status === "demo" ? "is-demo" : undefined}>
          <p className="kicker">
            {decision.organisation_name ?? "Group"} · {formatShortDate(decision.deadline)}
            {decision.data_status === "demo" ? " · Demo" : ""}
          </p>
          <h3>
            <Link href={`/decisions/${decision.id}`}>{decision.title}</Link>
          </h3>
          <DataMark status={decision.data_status === "demo" ? "demo" : decision.data_status === "stale" ? "stale" : null} />
          {decision.context ? <p className="why">{decision.context}</p> : null}
          {decision.recommended_option ? (
            <p className="action-line">
              <span>→</span>
              {decision.recommended_option}
            </p>
          ) : null}
          {decision.cost_of_delay ? <p className="why">Cost of delay — {decision.cost_of_delay}</p> : null}
          <p className="who">Owner {decision.owner_name ?? "Unassigned"}</p>
          <div className="row-actions">
            <Link className="text-link" href={`/decisions/${decision.id}`}>
              Decide
            </Link>
            {assignees.length > 0 ? (
              <form action={delegateItem} className="delegate-form">
                <input type="hidden" name="entity_type" value="decision" />
                <input type="hidden" name="entity_id" value={decision.id} />
                <input type="hidden" name="next" value={next} />
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
            ) : null}
            <form action={deferItem}>
              <input type="hidden" name="id" value={decision.id} />
              <input type="hidden" name="next" value={next} />
              <button className="text-button" type="submit">
                Defer
              </button>
            </form>
          </div>
        </li>
      ))}
    </ol>
  );
}
