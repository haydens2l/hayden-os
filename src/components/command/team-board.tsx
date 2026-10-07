import Link from "next/link";
import { formatStamp } from "@/lib/dates";
import type { TeamMember } from "@/lib/db/types";

export function TeamBoard({ people }: { people: TeamMember[] }) {
  return (
    <div className="team-grid">
      {people.map((person) => (
        <Link className="card team-card" key={person.id} href={`/team/${person.id}`}>
          <p className="kicker">{person.organisation_name ?? "Group"}</p>
          <h3>{person.name}</h3>
          <p className="interpretation">{person.role}</p>
          <div className="counts">
            <span>{person.open_tasks} open</span>
            <span className={person.overdue_tasks > 0 ? "overdue" : ""}>{person.overdue_tasks} overdue</span>
            <span>{person.open_issues} issues</span>
          </div>
          {person.priorities.length > 0 ? (
            <ol>
              {person.priorities.map((priority) => (
                <li key={priority}>{priority}</li>
              ))}
            </ol>
          ) : (
            <p className="interpretation">No open work stored.</p>
          )}
          <p className="who">Last update {formatStamp(person.last_update)}</p>
        </Link>
      ))}
    </div>
  );
}
