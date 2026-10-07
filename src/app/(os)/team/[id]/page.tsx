import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { brisbaneToday, formatShortDate, formatStamp } from "@/lib/dates";
import { getTeamMember, listIssues, listTasksForPerson } from "@/lib/db/repository";

export const metadata: Metadata = { title: "Person" };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = getTeamMember(id);
  if (!person) notFound();
  const tasks = listTasksForPerson(id);
  const today = brisbaneToday(0);
  const issues = listIssues().filter((issue) => issue.assigned_to === id);

  return (
    <>
      <PageHeader
        kicker={person.organisation_name ?? "Team"}
        title={person.name}
        lede={`${person.role ?? "No role"}. ${person.responsibilities ?? ""}`}
      />
      <p className="meta">
        <span>{person.open_tasks} open</span>
        <span>{person.overdue_tasks} overdue</span>
        <span>Last update {formatStamp(person.last_update)}</span>
        {person.manager_name ? <span>Reports to {person.manager_name}</span> : null}
      </p>
      {person.notes ? <p className="why">{person.notes}</p> : null}
      <section className="section">
        <h2>Work</h2>
        <div className="stack">
          {tasks.map((task) => {
            const overdue = task.due_date && task.due_date < today && !["done", "dismissed", "delegated"].includes(task.status);
            return (
              <div key={task.id} className="record">
                <h3>{task.title}</h3>
                <p>
                  {task.organisation_name} · {task.status}
                  {task.due_date ? ` · due ${formatShortDate(task.due_date)}` : ""}
                  {overdue ? " · overdue" : ""}
                  {task.requires_hayden ? " · needs Hayden" : ""}
                </p>
                {task.why_it_matters ? <p>{task.why_it_matters}</p> : null}
              </div>
            );
          })}
        </div>
      </section>
      <section className="section">
        <h2>Issues</h2>
        <div className="stack">
          {issues.length === 0 ? <p className="quiet">No open issues assigned.</p> : null}
          {issues.map((issue) => (
            <div key={issue.id} className="record">
              <h3>{issue.title}</h3>
              <p>{issue.description}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
