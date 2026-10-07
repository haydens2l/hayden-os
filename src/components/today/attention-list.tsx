import Link from "next/link";
import { delegateItem, deferItem, setTaskStatus } from "@/lib/actions";
import { DataMark } from "@/components/ui/data-mark";
import { formatShortDate } from "@/lib/dates";
import type { AttentionItem } from "@/lib/priority/store";

const CLASS_LABEL: Record<string, string> = {
  hayden_now: "Hayden now",
  hayden_soon: "Hayden soon",
  delegate: "Delegate",
  monitor: "Monitor",
  ignore: "Ignore",
};

export type AssigneeOption = { value: string; label: string };

export function AttentionList({
  items,
  assignees,
  next,
  mode,
}: {
  items: AttentionItem[];
  assignees: AssigneeOption[];
  next: string;
  mode: "act" | "quiet";
}) {
  if (items.length === 0) {
    return <p className="quiet">{mode === "act" ? "Nothing needs you." : "Nothing in this group."}</p>;
  }

  return (
    <ol className="priorities">
      {items.map((item, index) => {
        const href = item.entityType === "decision" ? `/decisions/${item.id}` : `/today/${item.id}`;
        return (
          <li className={`priority ${item.dataStatus === "demo" ? "is-demo" : ""}`} key={`${item.entityType}-${item.id}`}>
            <span className="priority-index">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <p className="kicker">
                {item.organisationName ?? "No business"} · {CLASS_LABEL[item.classification] ?? item.classification}
                {item.dataStatus === "demo" ? " · Demo" : ""}
              </p>
              <h3>
                <Link href={href}>{item.title}</Link>
              </h3>
              <div className="meta">
                <DataMark status={item.dataStatus === "demo" ? "demo" : null} />
                <span>Score {item.score}</span>
                {item.estimatedMinutes ? <span>{item.estimatedMinutes} min</span> : null}
                <span>{item.ownerName ?? "Unassigned"}</span>
                {item.dueDate ? <span>Due {formatShortDate(item.dueDate)}</span> : null}
              </div>
              {item.why ? <p className="why">{item.why}</p> : null}
              {item.recommendedAction ? (
                <p className="action-line">
                  <span>→</span>
                  {item.recommendedAction}
                </p>
              ) : null}
              {item.expectedOutcome ? <p className="why">Outcome — {item.expectedOutcome}</p> : null}
              <p className="who">{item.reasoning}</p>
              {mode === "act" ? (
                <div className="row-actions">
                  <Link className="text-link" href={href}>
                    Open
                  </Link>
                  <form action={delegateItem} className="delegate-form">
                    <input type="hidden" name="entity_type" value={item.entityType} />
                    <input type="hidden" name="entity_id" value={item.id} />
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
                  {item.entityType === "task" ? (
                    <>
                      <form action={setTaskStatus}>
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="status" value="done" />
                        <input type="hidden" name="next" value={next} />
                        <button className="text-button" type="submit">
                          Done
                        </button>
                      </form>
                      <form action={setTaskStatus}>
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="status" value="dismissed" />
                        <input type="hidden" name="next" value={next} />
                        <button className="text-button" type="submit">
                          Dismiss
                        </button>
                      </form>
                    </>
                  ) : (
                    <>
                      <Link className="text-link" href={href}>
                        Decide
                      </Link>
                      <form action={deferItem}>
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="next" value={next} />
                        <button className="text-button" type="submit">
                          Defer
                        </button>
                      </form>
                    </>
                  )}
                </div>
              ) : (
                <div className="row-actions">
                  <Link className="text-link" href={href}>
                    Open
                  </Link>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
