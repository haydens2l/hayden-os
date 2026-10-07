import Link from "next/link";
import { TaskActions } from "@/components/command/task-actions";
import { formatShortDate } from "@/lib/dates";
import type { Person, Task } from "@/lib/db/types";

export function Priorities({
  tasks,
  people,
  limit,
  next = "/",
}: {
  tasks: Task[];
  people: Person[];
  limit?: number;
  next?: string;
}) {
  const shown = typeof limit === "number" ? tasks.slice(0, limit) : tasks;
  const delegates = people.filter((person) => person.id !== "hayden");

  if (shown.length === 0) {
    return <p className="quiet">Nothing here needs you. The team is holding the rest.</p>;
  }

  return (
    <ol className="priorities">
      {shown.map((task, index) => (
        <li className="priority" key={task.id} id={task.id}>
          <span className="priority-index">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <h3>
              <Link href={`/today/${task.id}`}>{task.title}</Link>
            </h3>
            <div className="meta">
              {task.organisation_name ? (
                <Link href={`/businesses/${task.organisation_id}`}>{task.organisation_name}</Link>
              ) : null}
              {task.estimated_minutes ? <span>{task.estimated_minutes} min</span> : null}
              {task.due_date ? <span>Due {formatShortDate(task.due_date)}</span> : null}
            </div>
            {task.why_it_matters ? <p className="why">{task.why_it_matters}</p> : null}
            {task.expected_impact ? <p className="why">Impact — {task.expected_impact}</p> : null}
            {task.recommended_action ? (
              <p className="action-line">
                <span>→</span>
                {task.recommended_action}
              </p>
            ) : null}
            <TaskActions
              taskId={task.id}
              next={next}
              assignees={delegates.map((person) => ({ value: `person:${person.id}`, label: person.name }))}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
