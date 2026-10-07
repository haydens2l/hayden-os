import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  assignExecutionAction,
  blockExecutionAction,
  noteExecutionAction,
  returnExecutionToCreativeAction,
  startExecutionAction,
  submitExecutionAction,
} from "@/lib/actions";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { executionBrief } from "@/lib/work/brief";
import { listNotes, listSubmissions } from "@/lib/work/execute";
import { EXECUTORS } from "@/lib/work/types";
import { getWork } from "@/lib/work/state";
import { personRecord } from "@/lib/work/people";

export const metadata: Metadata = { title: "Execution brief" };

export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const work = getWork(db, "production_pack", id);
  if (!work) notFound();
  const brief = executionBrief(db, id);
  const versions = listSubmissions(db, id);
  const notes = listNotes(db, id);
  const open = !["COMPLETE", "CANCELLED", "READY FOR REVIEW"].includes(work.stage);
  const names = EXECUTORS.map((personId) => personRecord(db, personId)?.name ?? personId);

  return (
    <>
      <PageHeader kicker={work.organisation ?? "Work"} title={work.title} lede={`${work.ownerName ?? "Unassigned"} · ${work.stage}`} />
      <p className="quiet">
        {work.stage === "READY FOR REVIEW" ? "Submitted. Waiting on Hayden." : work.haydenRequired ? work.haydenAction : "Hayden is not needed on this step."}
      </p>
      {work.blockedReason ? (
        <p>
          Blocked because {work.blockedReason}. Waiting on {work.waitingOn}.
        </p>
      ) : null}

      <section className="section">
        {brief.map((section) => (
          <div key={section.label}>
            <p className="kicker">{section.label}</p>
            <p className="why">{section.body}</p>
          </div>
        ))}
      </section>

      {versions.length ? (
        <section className="section">
          <p className="kicker">Versions</p>
          {versions.map((version) => (
            <p key={version.id}>
              V{version.version} · {version.review_status}
              {version.note ? ` · ${version.note}` : ""}
              {version.link ? ` · ${version.link}` : ""}
              {version.file_name ? ` · ${version.file_name}` : ""}
              {version.feedback ? ` · Feedback: ${version.feedback}` : ""}
            </p>
          ))}
        </section>
      ) : null}

      {notes.length ? (
        <section className="section">
          <p className="kicker">Notes</p>
          {notes.map((note) => (
            <p key={note.created_at}>{note.body}</p>
          ))}
        </section>
      ) : null}

      {work.stage === "READY FOR EXECUTION" || work.ownerType === "unassigned" ? (
        <form className="brain-form" action={assignExecutionAction}>
          <input type="hidden" name="packId" value={id} />
          <label>
            Assign
            <select name="ownerId" defaultValue="lily">
              {EXECUTORS.map((personId, index) => (
                <option key={personId} value={personId}>
                  {names[index]}
                </option>
              ))}
            </select>
          </label>
          <button className="decision-button decision-approve" type="submit">
            Assign
          </button>
        </form>
      ) : null}

      {open && work.ownerType === "human" ? (
        <section className="section">
          <form action={startExecutionAction}>
            <input type="hidden" name="packId" value={id} />
            <button className="decision-button decision-approve" type="submit">
              Start
            </button>
          </form>
          <form className="brain-form" action={blockExecutionAction}>
            <input type="hidden" name="packId" value={id} />
            <label>
              Blocked because
              <textarea name="reason" required />
            </label>
            <label>
              Waiting on
              <input name="waitingOn" required placeholder="Hayden, a client, a reference, an API" />
            </label>
            <button className="decision-button" type="submit">
              Mark blocked
            </button>
          </form>
          <form className="brain-form" action={noteExecutionAction}>
            <input type="hidden" name="packId" value={id} />
            <input type="hidden" name="authorId" value={work.ownerId ?? "executor"} />
            <label>
              Note
              <textarea name="body" required />
            </label>
            <button className="decision-button" type="submit">
              Add note
            </button>
          </form>
          <form className="brain-form" action={submitExecutionAction}>
            <input type="hidden" name="packId" value={id} />
            <input type="hidden" name="ownerId" value={work.ownerId ?? "executor"} />
            <label>
              Note
              <textarea name="note" />
            </label>
            <label>
              Link
              <input name="link" />
            </label>
            <label>
              File
              <input name="file" type="file" />
            </label>
            <button className="decision-button decision-approve" type="submit">
              Submit for review
            </button>
          </form>
          <form className="brain-form" action={returnExecutionToCreativeAction}>
            <input type="hidden" name="packId" value={id} />
            <label>
              Return to creative
              <textarea name="reason" required placeholder="The concept itself is broken because…" />
            </label>
            <button className="decision-button" type="submit">
              Return to creative
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
