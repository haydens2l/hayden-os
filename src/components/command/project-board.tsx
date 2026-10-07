import { formatShortDate } from "@/lib/dates";
import type { Project, ProjectStatus } from "@/lib/db/types";

const HEALTH: Record<string, string> = {
  on_track: "On track",
  watch: "Watch",
  blocked: "Blocked",
  action_required: "Action required",
};

function healthOf(project: Project) {
  if (project.health && HEALTH[project.health]) return project.health;
  if (project.status === "blocked" || project.blocked_by) return "blocked";
  if (project.hayden_involvement === "approval" || project.hayden_involvement === "required") return "action_required";
  if (project.status === "waiting") return "watch";
  return "on_track";
}

const COLUMNS: Array<{ status: ProjectStatus; label: string }> = [
  { status: "idea", label: "Ideas" },
  { status: "planned", label: "Planned" },
  { status: "active", label: "Active" },
  { status: "waiting", label: "Waiting" },
  { status: "blocked", label: "Blocked" },
  { status: "completed", label: "Complete" },
];

export function ProjectBoard({
  projects,
  driveLinks = {},
  progress = {},
}: {
  projects: Project[];
  driveLinks?: Record<string, Array<{ label: string; web_url: string | null }>>;
  progress?: Record<string, string>;
}) {
  return (
    <div className="board">
      {COLUMNS.map((column) => {
        const items = projects.filter((project) => project.status === column.status);
        return (
          <section key={column.status}>
            <h3 className="column-label">
              {column.label} · {items.length}
            </h3>
            {items.map((project) => (
              <article className="card project-card" key={project.id}>
                <p className="kicker">{HEALTH[healthOf(project)]}</p>
                <h3>{project.name}</h3>
                <p>{project.organisation_name}</p>
                <p>
                  <span className="label">Owner </span>
                  {project.owner_name ?? "Unassigned"}
                </p>
                <p>
                  <span className="label">Objective </span>
                  {project.objective ?? "None stored"}
                </p>
                <p>
                  <span className="label">Impact </span>
                  {project.expected_impact ?? "None stored"}
                </p>
                <p>
                  <span className="label">Next </span>
                  {project.next_action ?? "None stored"}
                </p>
                <p>
                  <span className="label">Deadline </span>
                  {formatShortDate(project.due_date)}
                </p>
                <p>
                  <span className="label">Blocker </span>
                  {project.blocked_by ?? "None"}
                </p>
                <p>
                  <span className="label">Hayden </span>
                  {project.hayden_involvement ?? "Not set"}
                </p>
                {progress[project.id] ? (
                  <p>
                    <span className="label">Stages </span>
                    {progress[project.id]}
                  </p>
                ) : null}
                {(driveLinks[project.id] ?? []).length > 0 ? (
                  <p>
                    <span className="label">Drive </span>
                    {(driveLinks[project.id] ?? []).map((link) =>
                      link.web_url ? (
                        <a key={link.label} href={link.web_url} target="_blank" rel="noreferrer">
                          {link.label}{" "}
                        </a>
                      ) : (
                        <span key={link.label}>{link.label} </span>
                      ),
                    )}
                  </p>
                ) : null}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
