import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { checkContinuity } from "../src/lib/factory/continuity";
import { validateDuration } from "../src/lib/factory/duration";
import { returnToCreative } from "../src/lib/factory/loops";
import { modelCapability } from "../src/lib/factory/models";
import { executionView, getPack, listScenes, recordFeedback } from "../src/lib/factory/store";
import { syncDatabase } from "../src/lib/db/seed";
import { setTeamDrafter, type Draft } from "../src/lib/team/draft";
import { assignAndRun, setConceptStatus } from "../src/lib/team/work";

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
  const file = path.join(os.tmpdir(), `hayden-factory-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  syncDatabase(db);
  return db;
}

function insertConcept(db: Database.Database, status: string) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO creative_concepts (
      id, organisation_id, brand, title, concept, hook, format, status, created_by, created_at, production_status
    ) VALUES (?, 'property-made-simple', 'Property Made Simple', 'The Mortgage Housemate', ?, 'Meet Dave. He moved in on settlement day.', 'Short video', ?, 'creative', ?, 'concept_only')`,
  ).run(id, "The mortgage is the housemate who takes a cut of every payday.", status, new Date().toISOString());
  return id;
}

const packJson = {
  productionType: "ai_video",
  aspectRatio: "9:16",
  targetDuration: "18 seconds",
  voiceDirection: "Dry Australian humour. Everyday, understated, not a commercial announcer.",
  globalVisualDirection: "Lived-in suburban house, warm afternoon light, comedy first.",
  characters: [
    {
      name: "Dave",
      appearance: "Ordinary Australian man about 35",
      hair: "Short brown",
      clothing: "Faded navy t-shirt",
      accessories: "None",
      personality: "Too comfortable",
      voice: "Dry",
      accent: "Australian",
      bodyLanguage: "Spreads out on the couch",
      referenceNotes: "Keep the same shirt in every scene.",
    },
  ],
  locations: [{ name: "Lounge", description: "Suburban lounge, afternoon light, couch facing a quiet TV." }],
  continuityRules: "Dave stays in the navy t-shirt. Afternoon light does not jump to night.",
  editingNotes: "Hold the joke before any graphic.",
  musicDirection: "Light room tone. No trailer hit.",
  soundDirection: "Couch creak and room tone. Silence under the punchline.",
  onScreenText: "He takes a cut of payday.",
  cta: "",
  disclaimers: "Not a promise about a mortgage.",
  generationModel: null,
  scenes: [1, 2, 3].map((sceneNumber) => ({
    sceneNumber,
    durationSeconds: 6,
    objective: sceneNumber === 1 ? "Introduce the housemate." : "Keep Dave on the couch.",
    visual: "Afternoon light through the lounge window.",
    action: "Dave stays on the couch.",
    characters: "Dave, navy t-shirt, short brown hair.",
    location: "Suburban lounge",
    camera: "Wide, then a small push in.",
    startFrame: "Dave seated on the left side of the couch, afternoon light, navy t-shirt, empty hands.",
    endFrame: "Dave seated on the left side of the couch, afternoon light, navy t-shirt, empty hands.",
    voiceover: sceneNumber === 1 ? "Meet Dave. He moved in the day we got the keys." : "He does not cook.",
    speaker: "Voiceover",
    sfx: "Room tone",
    musicNotes: "No music under the line.",
    onScreenText: "",
    continuityFrom: sceneNumber === 1 ? "" : "Dave is still on the left of the couch in the same shirt.",
    continuityInto: "Dave remains on the left of the couch in the same shirt.",
    productionNotes: "Concept only until a person generates the shot.",
  })),
};

const drafter = async (system: string): Promise<Draft> => {
  if (system.includes("Content Factory")) {
    return { ok: true, text: JSON.stringify(packJson), model: "test-model", inputTokens: 40, outputTokens: 80 };
  }
  return {
    ok: true,
    text: JSON.stringify({
      concepts: [
        {
          title: "Follow-up concept",
          objective: "Repair the brief",
          audience: "Everyday Australians",
          hook: "A new hook, not a silent rewrite of the old one.",
          coreIdea: "Separate idea stored as a new concept.",
          format: "Short video",
          script: "Outline",
          visual: "Lounge",
          why: "The pack sent this back.",
          cta: "",
          complexity: "Low",
          variations: "",
          nextAction: "Hayden reviews it.",
        },
      ],
    }),
    model: "test-model",
    inputTokens: 10,
    outputTokens: 10,
  };
};

async function main() {
  setTeamDrafter(drafter);
  const db = openDb();
  try {
    const rulesBefore = (db.prepare(`SELECT COUNT(*) AS n FROM production_rules`).get() as { n: number }).n;
    const conceptId = insertConcept(db, "idea");
    setConceptStatus(db, conceptId, "approved");
    const approved = db.prepare(`SELECT status, approved_by FROM creative_concepts WHERE id = ?`).get(conceptId) as { status: string; approved_by: string };
    check("A approved", approved.status === "approved" && approved.approved_by === "hayden");

    const job = await assignAndRun(db, {
      agentId: "content",
      objective: `Produce a production pack for concept:${conceptId}. The Mortgage Housemate`,
      requestedBy: "hayden",
      requestedByLabel: "Hayden",
      title: "Production pack · The Mortgage Housemate",
    });
    const pack = db.prepare(`SELECT * FROM production_packs WHERE job_id = ?`).get(job.id) as { id: string; status: string; production_type: string; script: string };
    check("A pack stored", Boolean(pack?.id), job.output_summary ?? "");
    check("A type is ai video", pack?.production_type === "ai_video");
    check("F not complete", pack?.status !== "complete" && pack?.status !== "published" && pack?.status === "needs_review", pack?.status);
    const conceptStatus = db.prepare(`SELECT production_status FROM creative_concepts WHERE id = ?`).get(conceptId) as { production_status: string };
    check("F concept not published", conceptStatus.production_status === "pack_drafted");

    const scenes = listScenes(db, pack.id);
    check("B three scenes", scenes.length === 3, String(scenes.length));
    check(
      "B scene fields",
      scenes.every((scene) => scene.start_frame && scene.end_frame && scene.video_prompt && scene.voiceover && scene.sfx && scene.continuity_into),
    );
    check("B prompt is copy ready", Boolean(scenes[0]?.video_prompt?.includes("Start frame") && scenes[0]?.video_prompt?.includes("Negative constraints")));

    const mismatch = checkContinuity(
      [
        { sceneNumber: 2, startFrame: "Dave on the couch.", endFrame: "Dave holding coffee in his right hand." },
        { sceneNumber: 3, startFrame: "Dave on the couch with no coffee.", endFrame: "Dave on the couch." },
      ],
      { requireFrames: true },
    );
    check("C catches missing coffee", mismatch.some((issue) => issue.scene === 3 && /coffee/i.test(issue.problem)), JSON.stringify(mismatch));

    const flagged = validateDuration({
      durationSeconds: 6,
      dialogue: Array.from({ length: 32 }, (_, index) => `word${index + 1}`).join(" "),
    });
    check("D flags long dialogue", !flagged.ok && flagged.estimatedSeconds > 6, flagged.message);

    const view = executionView(db, pack.id);
    const viewText = JSON.stringify(view);
    check("E lily view has scenes", Boolean(view && view.scenes.length === 3 && view.scenes[0]?.startFrame && view.script));
    check("E no brain dump", !/business brain|creative principle|know-pms/i.test(viewText));
    check("E checklist not done", view?.checklist.scenesGenerated === false && view?.checklist.assetsCreated === false);

    const feedbackCountRules = rulesBefore;
    recordFeedback(db, {
      packId: pack.id,
      sceneId: scenes[0].id,
      modelProfileId: "profile-veo",
      kind: "prompt_failed",
      note: "The prompt failed in generation.",
      createdBy: "lily",
    });
    const rulesAfter = (db.prepare(`SELECT COUNT(*) AS n FROM production_rules`).get() as { n: number }).n;
    const feedback = db.prepare(`SELECT kind, model_profile_id FROM production_feedback WHERE pack_id = ?`).get(pack.id) as { kind: string; model_profile_id: string };
    check("G feedback stored", feedback?.kind === "prompt_failed" && feedback.model_profile_id === "profile-veo");
    check("G no new global rule", rulesAfter === feedbackCountRules, `${rulesBefore} -> ${rulesAfter}`);

    const unknown = modelCapability(db, "veo", "audio_support");
    check("H unknown capability", unknown === "UNKNOWN", unknown);
    const capabilityJob = await assignAndRun(db, {
      agentId: "content",
      objective: "Does Veo support audio? Report the capability.",
      requestedBy: "hayden",
      requestedByLabel: "Hayden",
    });
    check("H job says unknown", /UNKNOWN/i.test(capabilityJob.output_summary ?? ""), capabilityJob.output_summary ?? "");

    const before = (db.prepare(`SELECT concept FROM creative_concepts WHERE id = ?`).get(conceptId) as { concept: string }).concept;
    const handoff = await returnToCreative(db, pack.id, "concept issue");
    const after = (db.prepare(`SELECT concept FROM creative_concepts WHERE id = ?`).get(conceptId) as { concept: string }).concept;
    const stored = db.prepare(`SELECT from_agent_id, to_agent_id FROM agent_handoffs WHERE id = ?`).get(handoff.handoffId) as { from_agent_id: string; to_agent_id: string };
    check("I handoff", stored?.from_agent_id === "content" && stored?.to_agent_id === "creative");
    check("I concept unchanged", before === after);

    const raw = insertConcept(db, "shortlisted");
    const blocked = await assignAndRun(db, {
      agentId: "content",
      objective: `Produce a production pack for concept:${raw}. Not approved`,
      requestedBy: "hayden",
      requestedByLabel: "Hayden",
    });
    const blockedPacks = db.prepare(`SELECT COUNT(*) AS n FROM production_packs WHERE job_id = ?`).get(blocked.id) as { n: number };
    check("gate blocks unapproved", /not been approved/i.test(blocked.output_summary ?? "") && blockedPacks.n === 0, blocked.output_summary ?? "");

    const owner = db.prepare(`UPDATE production_packs SET production_owner = 'lily', status = 'assigned' WHERE id = ?`).run(pack.id);
    check("E assigned lily", owner.changes === 1);
    const full = getPack(db, pack.id);
    check("script stored", Boolean(full?.script?.includes("Total estimated runtime")));
    check("active seat", (db.prepare(`SELECT status FROM agents WHERE id = 'content'`).get() as { status: string }).status === "active");
  } finally {
    setTeamDrafter(null);
    db.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log("\nAll content factory checks passed.");
}

void main();
