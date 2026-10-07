import Link from "next/link";
import { AnswerPanel, EXAMPLE_QUESTIONS } from "@/components/command/answer-panel";
import { ConceptReview, type ReviewConcept } from "@/components/command/concept-review";
import { Briefing } from "@/components/command/briefing";
import { DecisionList } from "@/components/command/decision-list";
import { Empire } from "@/components/command/empire";
import { AttentionList } from "@/components/today/attention-list";
import { ProjectBoard } from "@/components/command/project-board";
import { Pulse } from "@/components/command/pulse";
import { TeamBoard } from "@/components/command/team-board";
import { answerAsChief, isChiefQuestion } from "@/lib/chief/answer";
import { answerWithKnowledge, isKnowledgeQuestion, isLivePerformanceQuestion } from "@/lib/integrations/google-drive/answer";
import { shortlistedForReview } from "@/lib/team/coordinate";
import { isProductionCommand, isTeamQuestion } from "@/lib/team/route";
import { answerWork, isWorkQuestion } from "@/lib/work/command";
import { answerOps, isOpsQuestion } from "@/lib/ops/command";
import { answerAsTeam } from "@/lib/team/answer";
import { answerQuestion } from "@/lib/command/answer";
import { getDb } from "@/lib/db/client";
import { attentionWindow } from "@/lib/priority/engine";
import {
  listAgents,
  listAssignees,
  listCampaigns,
  listDecisions,
  listFindings,
  listOrganisations,
  listPeople,
  listProjects,
  listPulse,
  listTeam,
  loadToday,
  memorySnapshot,
} from "@/lib/db/repository";

export default async function CommandPage({ searchParams }: { searchParams: Promise<{ q?: string; captured?: string }> }) {
  const { q, captured } = await searchParams;
  const query = q?.trim() ?? "";
  const memory = memorySnapshot();
  const answer = !query
    ? null
    : isLivePerformanceQuestion(query)
      ? answerAsChief(getDb(), query)
      : isProductionCommand(query)
        ? await answerAsTeam(getDb(), query)
        : isOpsQuestion(query)
          ? answerOps(getDb(), query)
          : isWorkQuestion(query)
          ? answerWork(getDb(), query)
          : isTeamQuestion(query)
        ? await answerAsTeam(getDb(), query)
        : isKnowledgeQuestion(query)
        ? await answerWithKnowledge(getDb(), query)
        : isChiefQuestion(query)
          ? answerAsChief(getDb(), query)
          : answerQuestion(query, memory);
  const attention = attentionWindow(loadToday().attention, false);
  const capturedKind = ["task", "idea", "decision", "project", "note"].includes(captured ?? "") ? captured : null;

  if (query) {
    const review = conceptsOnAnswer(answer);
    return (
      <>
        {capturedKind ? <p className="lede">Captured as {capturedKind}. It is in the inbox, not on your morning list.</p> : null}
        {review.length > 0 ? <ConceptReview concepts={review} next={`/?q=${encodeURIComponent(query)}`} /> : null}
        {answer && review.length === 0 ? <AnswerPanel answer={answer} /> : null}
      </>
    );
  }

  return (
    <>
      <nav className="examples" aria-label="Example questions">
        {EXAMPLE_QUESTIONS.map((example) => (
          <Link key={example} href={`/?q=${encodeURIComponent(example)}`}>
            {example}
          </Link>
        ))}
      </nav>
      {capturedKind ? (
        <p className="lede">Captured as {capturedKind}. It is in the inbox, not on your morning list.</p>
      ) : null}
      <ConceptReview concepts={shortlistedForReview(getDb())} />

      <section className="section">
        <p className="kicker">Today</p>
        <h2>Good morning Hayden</h2>
        <p className="lede">{attention.length === 0 ? "Nothing needs you." : `${attention.length} for you this morning.`}</p>
        <AttentionList items={attention} assignees={listAssignees()} next="/" mode="act" />
        <p className="quiet">
          <Link href="/today">Open Today</Link>
        </p>
      </section>

      <section className="section">
        <p className="kicker">Businesses</p>
        <h2>Business pulse</h2>
        <Pulse cards={listPulse()} />
      </section>

      <section className="section">
        <p className="kicker">Signals</p>
        <h2>AI briefing</h2>
        <p className="lede">From the current snapshot. The Chief of Staff is not writing these yet.</p>
        <Briefing findings={listFindings()} />
      </section>

      <section className="section">
        <p className="kicker">Structure</p>
        <h2>Empire map</h2>
        <Empire
          organisations={listOrganisations()}
          people={listPeople()}
          projects={listProjects()}
          campaigns={listCampaigns()}
          agents={listAgents()}
        />
      </section>

      <section className="section">
        <p className="kicker">People</p>
        <h2>Team</h2>
        <TeamBoard people={listTeam()} />
      </section>

      <section className="section">
        <p className="kicker">Work</p>
        <h2>Projects</h2>
        <ProjectBoard projects={listProjects()} />
      </section>

      <section className="section">
        <p className="kicker">Judgement</p>
        <h2>Decision queue</h2>
        <p className="lede">Only calls that need you. Ordinary tasks stay off this list.</p>
        <DecisionList decisions={listDecisions("open")} assignees={listAssignees()} next="/" />
      </section>

      <p className="footer-note">Local operating snapshot. Live ad, CRM, call and finance connections are not on.</p>
    </>
  );
}

function conceptsOnAnswer(answer: unknown): ReviewConcept[] {
  if (!answer || typeof answer !== "object" || !("review" in answer)) return [];
  const review = answer.review;
  return Array.isArray(review) ? review : [];
}
