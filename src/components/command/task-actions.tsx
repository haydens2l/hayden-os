import Link from "next/link";
import { delegateItem, setTaskStatus } from "@/lib/actions";

export type AssigneeOption = { value: string; label: string };

export function TaskActions({
  taskId,
  next,
  assignees,
}: {
  taskId: string;
  next: string;
  assignees: AssigneeOption[];
}) {
  return (
    <div className="row-actions">
      <Link className="text-link" href={`/today/${taskId}`}>
        Open
      </Link>
      <form action={delegateItem} className="delegate-form">
        <input type="hidden" name="entity_type" value="task" />
        <input type="hidden" name="entity_id" value={taskId} />
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
      <form action={setTaskStatus}>
        <input type="hidden" name="id" value={taskId} />
        <input type="hidden" name="status" value="done" />
        <input type="hidden" name="next" value={next} />
        <button className="text-button" type="submit">
          Done
        </button>
      </form>
      <form action={setTaskStatus}>
        <input type="hidden" name="id" value={taskId} />
        <input type="hidden" name="status" value="dismissed" />
        <input type="hidden" name="next" value={next} />
        <button className="text-button" type="submit">
          Dismiss
        </button>
      </form>
    </div>
  );
}
