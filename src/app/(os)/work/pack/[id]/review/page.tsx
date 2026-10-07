import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveExecutionAction, dismissRuleSuggestionAction, requestExecutionChangesAction, saveRuleSuggestionAction } from "@/lib/actions";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { listSubmissions } from "@/lib/work/execute";
import { pendingSuggestion } from "@/lib/work/rules";
import { getWork } from "@/lib/work/state";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const work = getWork(db, "production_pack", id);
  if (!work) notFound();
  const versions = listSubmissions(db, id);
  const suggestion = pendingSuggestion(db, "production_pack", id);
  const waiting = work.stage === "READY FOR REVIEW";

  return (
    <>
      <PageHeader kicker="Review" title={work.title} lede={`${work.organisation ?? "Unassigned"} · ${work.stage}`} />
      <p className="quiet">
        <Link href={`/work/pack/${id}`}>Execution brief</Link>
      </p>
      {work.outcome ? <p>{work.outcome}</p> : null}
      <section className="section">
        <p className="kicker">Versions</p>
        {versions.length === 0 ? <p className="quiet">Nothing has been submitted.</p> : null}
        {versions.map((version) => (
          <article key={version.id}>
            <h2>
              V{version.version} · {version.review_status}
            </h2>
            <p>{version.note || "No note."}</p>
            {version.link ? <p>{version.link}</p> : null}
            {version.file_name ? <p>{version.file_name}</p> : null}
            {version.file_path ? <p className="quiet">{version.file_path}</p> : null}
            {version.feedback ? <p>Feedback: {version.feedback}</p> : null}
          </article>
        ))}
      </section>
      {waiting ? (
        <section className="section">
          <form action={approveExecutionAction}>
            <input type="hidden" name="packId" value={id} />
            <button className="decision-button decision-approve" type="submit">
              Approve
            </button>
          </form>
          <form className="brain-form" action={requestExecutionChangesAction}>
            <input type="hidden" name="packId" value={id} />
            <label>
              What needs to change
              <textarea name="feedback" required placeholder="The first three seconds are too slow." />
            </label>
            <button className="decision-button decision-changes" type="submit">
              Request changes
            </button>
          </form>
        </section>
      ) : null}
      {suggestion ? (
        <section className="section">
          <p className="kicker">Potential reusable preference</p>
          <p>{suggestion.body}</p>
          <p className="quiet">This is not saved until you say so. It is not a performance claim.</p>
          <form action={saveRuleSuggestionAction}>
            <input type="hidden" name="id" value={suggestion.id} />
            <input type="hidden" name="next" value={`/work/pack/${id}/review`} />
            <button className="decision-button decision-approve" type="submit">
              Save rule
            </button>
          </form>
          <form action={dismissRuleSuggestionAction}>
            <input type="hidden" name="id" value={suggestion.id} />
            <input type="hidden" name="next" value={`/work/pack/${id}/review`} />
            <button className="decision-button" type="submit">
              Just this video
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
