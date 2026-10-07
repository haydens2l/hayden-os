import type { Metadata } from "next";
import Link from "next/link";
import { HELP_SECTIONS, capabilityGroups } from "@/lib/help/guide";

export const metadata: Metadata = { title: "How to use" };

export default function HelpPage() {
  const capabilities = capabilityGroups();
  return (
    <article className="help-page">
      <header className="page-header">
        <p className="kicker">Help</p>
        <h1>How to use Hayden OS</h1>
        <p className="lede">What you can ask for, where to click, and what still needs you.</p>
      </header>
      <nav className="help-nav" aria-label="How to use sections">
        {HELP_SECTIONS.map((section) => (
          <Link key={section.id} href={`#${section.id}`}>
            {section.title}
          </Link>
        ))}
      </nav>
      <section className="section" id="status">
        <h2>What works right now</h2>
        <ul className="help-list">
          {capabilities.available.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h2>Video generation</h2>
        <ul className="help-list">
          <li>Built: {capabilities.video.built ? "Yes" : "No"}</li>
          <li>Configured: {capabilities.video.configured ? "Yes" : "No"}</li>
          <li>Reason: {capabilities.video.reason}</li>
        </ul>
        <h2>Not connected</h2>
        <ul className="help-list">
          {capabilities.notConnected.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h2>Planned</h2>
        <ul className="help-list">
          {capabilities.planned.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      {HELP_SECTIONS.map((section) => (
        <section className="section" id={section.id} key={section.id}>
          <h2>{section.title}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.examples ? (
            <ul className="help-list">
              {section.examples.map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </article>
  );
}
