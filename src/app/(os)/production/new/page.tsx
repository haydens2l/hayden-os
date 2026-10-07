import type { Metadata } from "next";
import { startNewContent } from "@/lib/actions";

export const metadata: Metadata = { title: "Create content" };

export default function NewContentPage() {
  return (
    <article>
      <header className="page-header">
        <p className="kicker">Content</p>
        <h1>What are we making?</h1>
        <p className="lede">A rough idea is enough. The concept and a draft script come back for you to read. Nothing is locked.</p>
      </header>
      <form action={startNewContent} className="stack">
        <label>Brand<input name="brand" placeholder="Property Made Simple" /></label>
        <label>Idea<textarea name="idea" rows={4} placeholder="People waiting forever for the perfect time to buy property." /></label>
        <label>Objective<input name="objective" placeholder="Optional" /></label>
        <label>Audience<input name="audience" placeholder="Optional" /></label>
        <label>Format<input name="contentType" placeholder="Short video" /></label>
        <label>Platform<input name="platform" placeholder="Optional" /></label>
        <label>Duration in seconds<input name="duration" placeholder="45" /></label>
        <label>Reference<input name="reference" placeholder="Optional" /></label>
        <button type="submit">Create content</button>
      </form>
    </article>
  );
}
