import type { Metadata } from "next";
import Link from "next/link";
import { Briefing } from "@/components/command/briefing";
import { PageHeader } from "@/components/ui/page-header";
import { formatShortDate } from "@/lib/dates";
import { listContent, listExperiments, listFindings, listIssues, listKnowledge, listOpportunities } from "@/lib/db/repository";

export const metadata: Metadata = { title: "Intelligence" };

export default function IntelligencePage() {
  const content = listContent();
  const experiments = listExperiments();
  const issues = listIssues();
  const opportunities = listOpportunities();
  const knowledge = listKnowledge();

  return (
    <>
      <PageHeader
        kicker="Memory"
        title="Intelligence"
        lede="Findings stay separate from the strategy. The Business brain holds why each business exists and how you want it treated."
      />
      <p className="lede">
        <Link href="/intelligence/brain">Open the Business brain</Link>
        {" · "}
        <Link href="/intelligence/knowledge">Search business knowledge</Link>
      </p>
      <section className="section">
        <h2>Briefing</h2>
        <Briefing findings={listFindings()} />
      </section>
      <section className="section">
        <h2>Issues</h2>
        <div className="stack">
          {issues.map((issue) => (
            <div key={issue.id} className="record">
              <h3>{issue.title}</h3>
              <p>
                {issue.organisation_name} · {issue.severity} · {issue.assignee_name ?? "Unassigned"} ·{" "}
                {issue.requires_hayden ? "Needs you" : "With the team"}
              </p>
              <p>{issue.description}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="section">
        <h2>Opportunities</h2>
        <div className="stack">
          {opportunities.map((item) => (
            <div key={item.id} className="record">
              <h3>{item.title}</h3>
              <p>
                {item.organisation_name} · {item.confidence} confidence · {item.owner_name}
              </p>
              <p>{item.description}</p>
              <p>{item.recommended_action}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="section">
        <h2>Content</h2>
        <div className="stack">
          {content.map((item) => (
            <div key={item.id} className="record">
              <h3>{item.hook || item.concept}</h3>
              <p>
                {item.brand} · {item.platform} · reach {item.reach?.toLocaleString("en-AU") ?? "—"} · {formatShortDate(item.publish_date)}
              </p>
              <p>{item.notes}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="section">
        <h2>Experiments</h2>
        <div className="stack">
          {experiments.map((experiment) => (
            <div key={experiment.id} className="record">
              <h3>{experiment.name}</h3>
              <p>
                {experiment.organisation_name} · {experiment.status} · ends {formatShortDate(experiment.end_date)}
              </p>
              <p>{experiment.hypothesis}</p>
              <p>
                Control: {experiment.control}. Variant: {experiment.variant}.
              </p>
              <p>{experiment.learning}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="section">
        <h2>Knowledge</h2>
        <div className="stack">
          {knowledge.map((item) => (
            <div key={item.id} className="record">
              <h3>{item.title}</h3>
              <p>
                {item.category} · {item.organisation_name ?? "Group"} · {item.confidence}
              </p>
              <p>{item.content}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
