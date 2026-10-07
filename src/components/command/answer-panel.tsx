import Link from "next/link";
import { assignToAgent } from "@/lib/actions";
import type { CommandAnswer } from "@/lib/command/answer";
import type { TeamAction } from "@/lib/team/answer";

export function AnswerPanel({ answer }: { answer: CommandAnswer & { actions?: TeamAction[] } }) {
  return (
    <section className="answer" aria-live="polite">
      <p className="kicker">From business memory</p>
      <h2>{answer.heading}</h2>
      <p className="quiet">{answer.summary}</p>
      {answer.items.length > 0 ? (
        <ol className="answer-list">
          {answer.items.map((item, index) => (
            <li key={`${item.source}-${item.title}-${index}-${item.detail.slice(0, 48)}`}>
              {item.kind ? <span className="kicker">{item.kind}</span> : null}
              {item.href?.startsWith("http") ? (
                <a href={item.href} target="_blank" rel="noreferrer">
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </a>
              ) : item.href ? (
                <Link href={item.href}>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </Link>
              ) : (
                <>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </>
              )}
              <span className="source">{item.source}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {answer.actions?.map((action) => (
        <form action={assignToAgent} className="row-actions" key={action.label}>
          <input type="hidden" name="agentId" value={action.agentId} />
          <input type="hidden" name="objective" value={action.objective} />
          <input type="hidden" name="requestedBy" value={action.requestedBy} />
          <input type="hidden" name="next" value="/agents" />
          <button className="text-button" type="submit">
            {action.label}
          </button>
        </form>
      ))}
    </section>
  );
}

export const EXAMPLE_QUESTIONS = [
  "What should I focus on today?",
  "What's going wrong?",
  "How are the businesses performing?",
  "What is Lily working on?",
  "What decisions am I sitting on?",
  "What happened this week?",
  "What is the strategy for Speed to Lead?",
  "What are the biggest unknowns?",
  "How did Meta perform yesterday?",
];
