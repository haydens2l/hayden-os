import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { taskBrief } from "@/lib/work/brief";
import { getWork } from "@/lib/work/state";

export const metadata: Metadata = { title: "Task" };

export default async function TaskWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const work = getWork(db, "task", id);
  if (!work) notFound();
  const brief = taskBrief(db, id);
  return (
    <>
      <PageHeader kicker={work.organisation ?? "Task"} title={work.title} lede={`${work.ownerName ?? "Unassigned"} · ${work.stage}`} />
      <p className="quiet">{work.haydenRequired ? work.haydenAction : "Does not need you."}</p>
      {brief.map((section) => (
        <section className="section" key={section.label}>
          <p className="kicker">{section.label}</p>
          <p>{section.body}</p>
        </section>
      ))}
    </>
  );
}