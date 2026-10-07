import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { syncDatabase } from "../src/lib/db/seed";
import { setTeamDrafter, type Draft } from "../src/lib/team/draft";
import { answerAsTeam } from "../src/lib/team/answer";
import { noticesForJob, requestHandoff, teamBoard } from "../src/lib/team/work";

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS ${name}`);
    return;
  }
  failures.push(detail ? `${name} — ${detail}` : name);
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function openDb() {
  const file = path.join(os.tmpdir(), `hayden-team-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  syncDatabase(db);
  return db;
}

function concepts(count: number) {
  return {
    concepts: Array.from({ length: count }, (_, index) => ({
      title: `PMS idea ${index + 1}`,
      objective: "Earn attention",
      audience: "Everyday Australians",
      hook: `Hook ${index + 1}`,
      coreIdea: "A character comparison, not a finance lecture.",
      format: "Short video",
      script: "Outline only.",
      visual: "Suburban driveway",
      why: "Entertainment first, from the stored principle.",
      cta: "",
      complexity: "Low",
      variations: "One alternate ending",
      nextAction: "Shortlist before production.",
    })),
  };
}

const drafter = async (system: string): Promise<Draft> => {
  if (system.includes("Creative Director")) {
    const count = /exactly (\d+)/.exec(system)?.[1] ?? "5";
    return { ok: true, text: JSON.stringify(concepts(Number(count))), model: "test-model", inputTokens: 120, outputTokens: 80 };
  }
  if (system.includes("Growth Strategist")) {
    return {
      ok: true,
      text: JSON.stringify({
        observation: "The mortgage-free date is a curiosity mechanism in the stored positioning.",
        opportunity: "The calculator can open a question instead of a product pitch.",
        hypothesis: "A curiosity-led calculator page can earn more relevant enquiries than a generic mortgage ad.",
        test: "Compare the calculator opening with a direct benefit opening once a live source exists.",
        expectedImpact: "Unknown until measured.",
        measurement: "To be defined once live campaign data exists.",
        dependencies: "A live campaign source.",
        owner: "Hayden",
        haydenRequired: false,
      }),
      model: "test-model",
      inputTokens: 90,
      outputTokens: 60,
    };
  }
  return {
    ok: true,
    text: JSON.stringify({
      observation: "The useful question is a repeatable format and an audience that would follow even without becoming a lead.",
      opportunity: "Brisbane Collective can become a series, not a single street-interview episode.",
      formats: [
        {
          name: "People, places, possibilities",
          description: "A repeatable local conversation series.",
          pillar: "Brisbane culture",
          repeatability: 4,
          complexity: "Low",
          commercial: "Possible later",
          why: "The stored notes put the audience first.",
          distribution: "Owned channels",
          monetisation: "None selected. Partnerships are a possibility, not a result.",
          nextTest: "Define one episode shape.",
        },
      ],
    }),
    model: "test-model",
    inputTokens: 100,
    outputTokens: 70,
  };
};

async function main() {
  setTeamDrafter(drafter);
  const db = openDb();

  const creative = await answerAsTeam(db, "Give me five Property Made Simple video concepts.");
  const creativeJob = db.prepare(`SELECT * FROM agent_jobs WHERE agent_id = 'creative' ORDER BY created_at DESC LIMIT 1`).get() as {
    id: string;
    input_context: string;
    output_summary: string;
  };
  const stored = db.prepare(`SELECT COUNT(*) AS n FROM creative_concepts WHERE job_id = ?`).get(creativeJob.id) as { n: number };
  check("A routes to Creative Director", creative.heading === "Creative Director");
  check("A retrieves Property Made Simple context", /Property Made Simple/.test(creativeJob.input_context ?? ""));
  check("A returns five concepts", creative.items.length === 5 && stored.n === 5, String(stored.n));

  const growth = await answerAsTeam(db, "How would you improve the mortgage calculator funnel?");
  const experiment = db.prepare(`SELECT status, result FROM experiments ORDER BY rowid DESC LIMIT 1`).get() as { status: string; result: string | null };
  check("B routes to Growth", growth.heading === "Growth Strategist", growth.heading);
  check("B says live performance is unavailable", /live campaign performance/i.test(growth.summary), growth.summary);
  check("B proposes an experiment without an outcome", experiment.status === "proposed" && !experiment.result);

  const media = await answerAsTeam(db, "What could Brisbane Collective become beyond street interviews?");
  const format = db.prepare(`SELECT status, notes FROM media_formats ORDER BY created_at DESC LIMIT 1`).get() as { status: string; notes: string };
  const mediaText = `${media.summary} ${media.items.map((item) => item.detail).join(" ")}`;
  check("C routes to Media Director", media.heading === "Media Director", media.heading);
  check("C talks about repeatable audience and monetisation", /repeatable|audience|monetis/i.test(mediaText), mediaText);
  check("C stores the format as an idea", format.status === "idea");

  const handoff = await requestHandoff(db, {
    fromAgentId: "media",
    toAgentId: "creative",
    objective: "Develop three executions of the local conversation format.",
  });
  const link = db.prepare(`SELECT from_agent_id, to_agent_id, to_job_id FROM agent_handoffs WHERE id = ?`).get(handoff.handoffId) as {
    from_agent_id: string;
    to_agent_id: string;
    to_job_id: string;
  };
  const received = db.prepare(`SELECT requested_by, agent_id FROM agent_jobs WHERE id = ?`).get(link.to_job_id) as { requested_by: string; agent_id: string };
  check("D handoff is stored from Media to Creative", link.from_agent_id === "media" && link.to_agent_id === "creative");
  check("D Creative receives the job", received.agent_id === "creative" && received.requested_by === "media");

  const bulk = await answerAsTeam(db, "Give me 10 Property Made Simple video concepts.");
  const bulkJob = db.prepare(`SELECT id, tasks_created FROM agent_jobs WHERE objective LIKE 'Give me 10%' ORDER BY created_at DESC LIMIT 1`).get() as {
    id: string;
    tasks_created: string;
  };
  const notices = noticesForJob(db, bulkJob.id);
  const haydenTasks = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE requires_hayden = 1`).get() as { n: number };
  check("E one summary notice", notices.length === 1, String(notices.length));
  check("E notice does not demand ten reviews", notices[0]?.requires_hayden === 0 && /10 concepts/.test(notices[0]?.summary ?? ""));
  check("E no Hayden task per concept", haydenTasks.n === 0 && bulkJob.tasks_created === "[]");
  check("E ten concepts stored", bulk.items.length === 10);

  const cpl = await answerAsTeam(db, "Creative Director: what is our current CPL?");
  const cplText = `${cpl.summary} ${cpl.items.map((item) => item.detail).join(" ")}`;
  check("F creative does not invent CPL", /no live cpl/i.test(cplText) && !/\b\d+(\.\d+)?\b/.test(cpl.summary), cpl.summary);

  const blocked = await answerAsTeam(db, "Growth: publish an ad.");
  const blockedJob = db.prepare(`SELECT status, output_summary FROM agent_jobs WHERE agent_id = 'growth' AND objective LIKE 'Growth: publish%'`).get() as {
    status: string;
    output_summary: string;
  };
  check("G publish is blocked", blockedJob.status === "cancelled" && /cannot publish/i.test(blockedJob.output_summary), blockedJob.output_summary);
  check("G answer states the block", /cannot publish/i.test(blocked.summary));

  const board = teamBoard(db);
  const creativeSeat = board.find((seat) => seat.id === "creative");
  const future = board.find((seat) => seat.id === "sales");
  check("H creative shows a last run", Boolean(creativeSeat?.lastRun));
  check("H creative shows a finding", (creativeSeat?.finding ?? "None yet") !== "None yet");
  check("H creative shows token cost", /120 in \/ 80 out/.test(creativeSeat?.runCost ?? ""), creativeSeat?.runCost);
  check("H assignment is visible", creativeSeat?.assignment === "None" || Boolean(creativeSeat?.assignment));
  check("H future seat is not built", future?.seat === "NOT BUILT", future?.id);
  check("H active seats are idle after the run", ["chief-of-staff", "creative", "growth", "media", "content"].every((id) => board.find((seat) => seat.id === id)?.seat === "IDLE"));

  setTeamDrafter(null);
  if (failures.length > 0) {
    console.error(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log("\nAll AI team checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
