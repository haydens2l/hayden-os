import type { Metadata } from "next";
import { TeamBoard } from "@/components/command/team-board";
import { PageHeader } from "@/components/ui/page-header";
import { listTeam } from "@/lib/db/repository";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <>
      <PageHeader
        kicker="People"
        title="Team"
        lede="Humans only. Agent seats are on the Agents page, and none of them are running."
      />
      <TeamBoard people={listTeam()} />
    </>
  );
}
