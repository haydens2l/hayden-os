import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { replaceKnowledge, saveKnowledge, saveOrganisationStrategy, savePersonContext, saveQuestion } from "@/lib/actions";
import { CONTEXT_TYPES, contextLabel, humanToken, isCurrentContext } from "@/lib/brain/labels";
import { HowLink } from "@/components/shell/how-link";
import { PageHeader } from "@/components/ui/page-header";
import { formatShortDate } from "@/lib/dates";
import {
  listDecisions,
  listKnowledge,
  listOpenQuestions,
  listOpportunityFramework,
  listOrganisations,
  listPeople,
} from "@/lib/db/repository";
import type { Knowledge, Organisation, Person } from "@/lib/db/types";

export const metadata: Metadata = { title: "Business brain" };

export default function BrainPage() {
  const organisations = listOrganisations();
  const people = listPeople();
  const knowledge = listKnowledge();
  const questions = listOpenQuestions();
  const framework = listOpportunityFramework();
  const decisions = listDecisions("decided");
  const current = knowledge.filter((item) => isCurrentContext(item));
  const historical = knowledge.filter((item) => !isCurrentContext(item));

  return (
    <>
      <PageHeader
        kicker="Intelligence"
        title="Business brain"
        lede="Why each business exists, where you are taking it, and how it should be treated. This is founder-provided strategy. It is not live performance."
      />
      <p className="meta">
        <span>Manual · Founder provided</span>
        <Link href="/intelligence">Intelligence</Link>
      </p>
      <HowLink href="/help#brain" />

      <Section title="Current strategy" lede="The direction your time is moving toward.">
        <Records items={current.filter((item) => item.category === "doctrine")} />
      </Section>

      <Section title="Businesses" lede="Operating groups and companies. Strategic importance is not the same as how busy they are.">
        {organisations
          .filter((item) => item.type === "business")
          .map((item) => (
            <OrgCard key={item.id} organisation={item} />
          ))}
      </Section>

      <Section title="Brands" lede="Brands keep their own role, even when they sit inside a group.">
        {organisations
          .filter((item) => item.type === "brand")
          .map((item) => (
            <OrgCard key={item.id} organisation={item} />
          ))}
      </Section>

      <Section title="People" lede="Role direction only. No performance is stored here.">
        {people.map((person) => (
          <PersonCard key={person.id} person={person} />
        ))}
      </Section>

      <Section title="Operating doctrine" lede="How work should be split.">
        <Records items={current.filter((item) => item.category === "doctrine" || item.category === "operating" || item.category === "framework")} />
      </Section>

      <Section title="Key economics" lede="Arrangements you have described. Not a forecast, and not a live ledger.">
        <Records items={current.filter((item) => item.category === "economics")} />
        {current.every((item) => item.category !== "economics") ? <p className="quiet">No economics are stored.</p> : null}
      </Section>

      <Section title="Known facts">
        <Records items={current.filter((item) => item.context_type === "FACT")} />
      </Section>

      <Section title="Assumptions">
        <Records items={current.filter((item) => item.context_type === "ASSUMPTION" || item.context_type === "HYPOTHESIS")} />
      </Section>

      <Section title="Open questions" lede="Gaps. Hayden OS does not fill these in.">
        {questions.map((item) => (
          <article className="record" key={item.id} id={item.id}>
            <p className="kicker">
              Unknown · {item.status} · {item.organisation_name ?? "Whole system"} · Manual · Founder provided
            </p>
            <h3>{item.question}</h3>
            {item.why_it_matters ? <p>{item.why_it_matters}</p> : null}
            <details>
              <summary>Correct this</summary>
              <form action={saveQuestion} className="brain-form">
                <input type="hidden" name="id" value={item.id} />
                <label>
                  Question
                  <textarea name="question" defaultValue={item.question} required />
                </label>
                <label>
                  Why it matters
                  <textarea name="why" defaultValue={item.why_it_matters ?? ""} />
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={item.status}>
                    <option value="open">Open</option>
                    <option value="answered">Answered</option>
                    <option value="dismissed">Dismissed</option>
                  </select>
                </label>
                <button className="text-button" type="submit">
                  Save
                </button>
              </form>
            </details>
          </article>
        ))}
        <details>
          <summary>Add an open question</summary>
          <form action={saveQuestion} className="brain-form">
            <label>
              Question
              <textarea name="question" required />
            </label>
            <label>
              Why it matters
              <textarea name="why" />
            </label>
            <input type="hidden" name="status" value="open" />
            <button className="text-button" type="submit">
              Add
            </button>
          </form>
        </details>
      </Section>

      <Section title="Recent decisions" lede="Choices already recorded. Ordinary tasks stay off this list.">
        {decisions.length === 0 ? <p className="quiet">No decisions have been recorded.</p> : null}
        {decisions.map((decision) => (
          <article className="record" key={decision.id}>
            <p className="kicker">
              Decision · {decision.organisation_name ?? "Group"} · {formatShortDate(decision.decided_at)}
            </p>
            <h3>
              <Link href={`/decisions/${decision.id}`}>{decision.title}</Link>
            </h3>
            <p>{decision.decision}</p>
          </article>
        ))}
      </Section>

      <Section title="Opportunity framework" lede="Score a new idea from 0 to 5 on each factor. The score is stored so you can decide. It does not decide for you.">
        {framework.map((factor) => (
          <article className="record" key={factor.id}>
            <h3>
              {factor.sort_order}. {factor.label}
            </h3>
            <p>{factor.guidance}</p>
          </article>
        ))}
      </Section>

      {historical.length > 0 ? (
        <Section title="Superseded" lede="Older direction. It stays available and does not drive the current answer.">
          <Records items={historical} />
        </Section>
      ) : null}
    </>
  );
}

function Section({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {lede ? <p className="lede">{lede}</p> : null}
      <div className="stack">{children}</div>
    </section>
  );
}

function OrgCard({ organisation }: { organisation: Organisation }) {
  return (
    <article className="record" id={organisation.id}>
      <p className="kicker">
        {organisation.type} · Priority {organisation.strategic_priority ?? "—"} · {humanToken(organisation.growth_intent)} · Manual · Founder provided
      </p>
      <h3>
        <Link href={`/businesses/${organisation.id}`}>{organisation.name}</Link>
      </h3>
      <p>{humanToken(organisation.strategic_role)}</p>
      <p>{organisation.primary_objective}</p>
      <p>Hayden — {organisation.hayden_role}</p>
      <p>Involvement — {organisation.desired_hayden_involvement}</p>
      <p>Model — {organisation.business_model}</p>
      <p>Horizon — {organisation.time_horizon}</p>
      <details>
        <summary>Correct this</summary>
        <form action={saveOrganisationStrategy} className="brain-form">
          <input type="hidden" name="id" value={organisation.id} />
          <label>
            Strategic role
            <input name="strategic_role" defaultValue={organisation.strategic_role ?? ""} />
          </label>
          <label>
            Strategic priority (1–5)
            <input name="strategic_priority" type="number" min={1} max={5} defaultValue={organisation.strategic_priority ?? 3} required />
          </label>
          <label>
            Growth intent
            <input name="growth_intent" defaultValue={organisation.growth_intent ?? ""} />
          </label>
          <label>
            Hayden&apos;s role
            <textarea name="hayden_role" defaultValue={organisation.hayden_role ?? ""} />
          </label>
          <label>
            Desired involvement
            <textarea name="desired_hayden_involvement" defaultValue={organisation.desired_hayden_involvement ?? ""} />
          </label>
          <label>
            Business model
            <textarea name="business_model" defaultValue={organisation.business_model ?? ""} />
          </label>
          <label>
            Primary objective
            <textarea name="primary_objective" defaultValue={organisation.primary_objective ?? ""} />
          </label>
          <label>
            Time horizon
            <input name="time_horizon" defaultValue={organisation.time_horizon ?? ""} />
          </label>
          <button className="text-button" type="submit">
            Save
          </button>
        </form>
      </details>
    </article>
  );
}

function PersonCard({ person }: { person: Person }) {
  return (
    <article className="record" id={person.id}>
      <p className="kicker">Manual · Founder provided</p>
      <h3>
        <Link href={`/team/${person.id}`}>{person.name}</Link>
      </h3>
      <p>{person.role}</p>
      <p>{person.responsibilities}</p>
      <p>{person.notes}</p>
      <details>
        <summary>Correct this</summary>
        <form action={savePersonContext} className="brain-form">
          <input type="hidden" name="id" value={person.id} />
          <label>
            Role
            <input name="role" defaultValue={person.role ?? ""} />
          </label>
          <label>
            Responsibilities
            <textarea name="responsibilities" defaultValue={person.responsibilities ?? ""} />
          </label>
          <label>
            Notes
            <textarea name="notes" defaultValue={person.notes ?? ""} />
          </label>
          <button className="text-button" type="submit">
            Save
          </button>
        </form>
      </details>
    </article>
  );
}

function Records({ items }: { items: Knowledge[] }) {
  if (items.length === 0) return <p className="quiet">Nothing stored in this group.</p>;
  return (
    <>
      {items.map((item) => (
        <article className="record" key={item.id} id={item.id}>
          <p className="kicker">
            {contextLabel(item.context_type)} · {item.organisation_name ?? "Whole system"} · Manual · Founder provided
          </p>
          <h3>{item.title}</h3>
          <p>{item.content}</p>
          <details>
            <summary>Correct this</summary>
            <form action={saveKnowledge} className="brain-form">
              <input type="hidden" name="id" value={item.id} />
              <label>
                Title
                <input name="title" defaultValue={item.title} required />
              </label>
              <label>
                Context type
                <select name="context_type" defaultValue={item.context_type ?? "STRATEGY"}>
                  {CONTEXT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {contextLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Confidence
                <input name="confidence" defaultValue={item.confidence ?? "high"} />
              </label>
              <label>
                Content
                <textarea name="content" defaultValue={item.content} required />
              </label>
              <button className="text-button" type="submit">
                Save
              </button>
            </form>
          </details>
          {isCurrentContext(item) ? (
            <details>
              <summary>Supersede this</summary>
              <form action={replaceKnowledge} className="brain-form">
                <input type="hidden" name="id" value={item.id} />
                <label>
                  New title
                  <input name="title" defaultValue={item.title} required />
                </label>
                <label>
                  New direction
                  <textarea name="content" required placeholder="The current direction. The old record stays as history." />
                </label>
                <button className="text-button" type="submit">
                  Replace
                </button>
              </form>
            </details>
          ) : null}
        </article>
      ))}
    </>
  );
}
