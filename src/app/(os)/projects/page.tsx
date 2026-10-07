import type { Metadata } from "next";
import { ProjectBoard } from "@/components/command/project-board";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { listProjects } from "@/lib/db/repository";
import { projectStageCounts } from "@/lib/work/state";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  const links = getDb().prepare(`SELECT project_id, label, web_url FROM project_drive_links`).all() as Array<{
    project_id: string;
    label: string;
    web_url: string | null;
  }>;
  const driveLinks: Record<string, Array<{ label: string; web_url: string | null }>> = {};
  for (const link of links) {
    driveLinks[link.project_id] ??= [];
    driveLinks[link.project_id].push({ label: link.label, web_url: link.web_url });
  }
  const db = getDb();
  const projects = listProjects();
  const progress: Record<string, string> = {};
  for (const project of projects) {
    const counts = projectStageCounts(db, project.id);
    if (counts) progress[project.id] = counts;
  }
  return (
    <>
      <PageHeader
        kicker="Work"
        title="Projects"
        lede="Executive view. Organisation, owner, objective, health, next action, deadline, blocker, and whether you are involved. Stage counts appear only where work is actually linked."
      />
      <ProjectBoard projects={projects} driveLinks={driveLinks} progress={progress} />
    </>
  );
}
