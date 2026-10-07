import { reviewConcept } from "@/lib/actions";

export type ReviewConcept = {
  id: string;
  brand: string | null;
  title: string;
  hook: string | null;
  concept: string | null;
  script_outline: string | null;
  format: string | null;
  why_it_may_work: string | null;
  production_complexity: string | null;
  notes: string | null;
  approved_by: string | null;
};

export function ConceptReview({ concepts, next = "/" }: { concepts: ReviewConcept[]; next?: string }) {
  if (concepts.length === 0) return null;
  const brand = concepts[0]?.brand ?? "Concept";
  const oneBrand = concepts.every((concept) => concept.brand === brand);
  const propertyMadeSimple = oneBrand && brand === "Property Made Simple";
  return (
    <section className="section concept-review" aria-label="Concepts for review">
      <p className="kicker">{oneBrand ? brand : "Concepts"}</p>
      <h2>{propertyMadeSimple ? "Your team worked on: mortgage payoff entertainment concept" : "Saved for your approval"}</h2>
      <p className="lede">{concepts.length} for your review. Nothing is produced until you approve one.</p>
      <div className="review-list">
        {concepts.map((concept, index) => {
          const shortlist = concept.notes
            ?.split("\n")
            .find((line) => line.startsWith("Shortlist:"))
            ?.replace(/^Shortlist:\s*/, "");
          return (
            <article className="review-card" key={concept.id}>
              <p className="kicker">Concept {index + 1} · waiting on you · {concept.approved_by ? `approved by ${concept.approved_by}` : "not approved"}</p>
              <h3>{concept.title}</h3>
              <div className="review-copy">
                <p>
                  <span className="review-label">Hook</span>
                  {concept.hook}
                </p>
                <p>
                  <span className="review-label">30-second explanation</span>
                  {concept.concept || concept.script_outline || "No explanation stored."}
                </p>
                <p>
                  <span className="review-label">{propertyMadeSimple ? "Why it fits Property Made Simple" : "Why it may work"}</span>
                  {concept.why_it_may_work || "No fit note stored."}
                </p>
                <div className="review-facts">
                  <p>
                    <span className="review-label">Proposed format</span>
                    {concept.format || "Not set"}
                  </p>
                  <p>
                    <span className="review-label">Estimated production complexity</span>
                    {concept.production_complexity || "Not set"}
                  </p>
                </div>
                {shortlist ? (
                  <p>
                    <span className="review-label">Why it was shortlisted</span>
                    {shortlist} Creative reasoning, not a performance result.
                  </p>
                ) : null}
              </div>
              <form action={reviewConcept} className="decision-actions">
                <input type="hidden" name="id" value={concept.id} />
                <input type="hidden" name="next" value={next} />
                <button className="decision-button decision-approve" name="status" value="approved" type="submit">
                  Approve
                </button>
                <button className="decision-button decision-changes" name="status" value="changes_requested" type="submit">
                  Changes
                </button>
                <button className="decision-button decision-reject" name="status" value="rejected" type="submit">
                  Reject
                </button>
              </form>
            </article>
          );
        })}
      </div>
      <p className="review-next">Approve one and Content Factory will turn it into a production-ready pack for Lily or Danny.</p>
    </section>
  );
}
