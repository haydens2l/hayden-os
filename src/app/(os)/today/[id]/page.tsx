import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TaskActions } from "@/components/command/task-actions";
import { DataMark } from "@/components/ui/data-mark";
import { PageHeader } from "@/components/ui/page-header";
import { formatShortDate } from "@/lib/dates";
import { getTask, listAssignees } from "@/lib/db/repository";

export const metadata: Metadata = { title: "Priority" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) notFound();
  const closed = task.status === "done" || task.status === "dismissed";

  return (
    <>
      <PageHeader kicker={task.organisation_name ?? "Task"} title={task.title} lede={task.why_it_matters ?? undefined} />
      <div className="stack">
        <div className="record">
          <p className="meta">
            <DataMark status={task.data_status} />
            <span>Owner {task.owner_name ?? "Unassigned"}</span>
            <span>Status {task.status}</span>
            <span>Due {formatShortDate(task.due_date)}</span>
            <span>Time {task.estimated_minutes ? `${task.estimated_minutes} min` : "Not stored"}</span>
          </p>
          {task.description ? <p>{task.description}</p> : null}
          {task.project_name ? (
            <p>
              Project: <Link href="/projects">{task.project_name}</Link>
            </p>
          ) : null}
          {task.recommended_action ? (
            <p className="action-line">
              <span>→</span>
              {task.recommended_action}
            </p>
          ) : null}
          {task.expected_outcome ? <p className="why">Outcome — {task.expected_outcome}</p> : null}
          {closed ? <p className="quiet">This is off your list.</p> : <TaskActions taskId={task.id} next={`/today/${task.id}`} assignees={listAssignees()} />}
        </div>
      </div>
    </>
  );
}
