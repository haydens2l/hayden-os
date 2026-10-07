import Database from "better-sqlite3";
import { ensureContentFactory } from "../src/lib/content/schema";
import { compileStylePrompt, styleById, styleCriticRules } from "../src/lib/content/styles";
import { approveVisuals, changeSpoken, createContentItem, developConcept, productionBlock, styleBlock, writeScript } from "../src/lib/content/workflow";

async function main() {
  const db = new Database("data/hayden.db");
  db.pragma("journal_mode = WAL");
  ensureContentFactory(db);
  const id = createContentItem(db, {
    idea: "People waiting forever for the perfect time to buy property.",
    brandText: "Property Made Simple",
    contentType: "short video",
    durationSeconds: 45,
  });
  await developConcept(db, id);
  await writeScript(db, id);
  const item = db.prepare(`SELECT id, stage, concept_id, title, brand FROM content_items WHERE id = ?`).get(id) as {
    id: string;
    stage: string;
    concept_id: string;
    title: string;
    brand: string;
  };
  const packs = db.prepare(`SELECT COUNT(*) AS n FROM production_packs WHERE creative_concept_id = ?`).get(item.concept_id) as { n: number };
  const lock = db.prepare(`SELECT COUNT(*) AS n FROM script_locks WHERE content_id = ?`).get(id) as { n: number };
  const concept = db.prepare(`SELECT title, status, hook, concept FROM creative_concepts WHERE id = ?`).get(item.concept_id) as {
    title: string;
    status: string;
    hook: string | null;
    concept: string | null;
  };
  const script = db.prepare(`SELECT audio_mode, spoken, voiceover, estimated_seconds, structure_json, status FROM content_scripts WHERE content_id = ?`).get(id) as {
    audio_mode: string;
    spoken: string | null;
    voiceover: string | null;
    estimated_seconds: number;
    structure_json: string;
    status: string;
  };
  const styles = db.prepare(`SELECT COUNT(*) AS n FROM style_templates WHERE status = 'approved' AND id NOT LIKE '%copy%'`).get() as { n: number };
  const missing = db.prepare(`SELECT COUNT(*) AS n FROM style_references WHERE status = 'required'`).get() as { n: number };
  const clay = compileStylePrompt(styleById("cinematic-miniature-claymation")!, "A man on a couch waits for the news to say buy.");
  const indie = compileStylePrompt(styleById("australian-indie-35mm")!, "A man on a couch waits for the news to say buy.");
  let visualLockBlocked = "";
  try {
    approveVisuals(db, id);
  } catch (error) {
    visualLockBlocked = error instanceof Error ? error.message : "blocked";
  }
  const guardId = createContentItem(db, { idea: "Guard check only.", brandText: "Property Made Simple" });
  db.prepare(`UPDATE content_items SET stage = 'LEGACY' WHERE id = ?`).run(guardId);
  const spokenId = crypto.randomUUID();
  db.prepare(`INSERT INTO content_scripts (id, content_id, version, spoken, status, created_at) VALUES (?, ?, 1, 'Original line.', 'draft', ?)`).run(spokenId, guardId, new Date().toISOString());
  db.prepare(`INSERT INTO script_locks (id, content_id, script_id, locked_by, created_at) VALUES (?, ?, ?, 'system-guard', ?)`).run(crypto.randomUUID(), guardId, spokenId, new Date().toISOString());
  let lockMessage = "";
  try {
    changeSpoken(db, guardId, "Silent rewrite.");
  } catch (error) {
    lockMessage = error instanceof Error ? error.message : "blocked";
  }
  const spokenAfter = db.prepare(`SELECT spoken FROM content_scripts WHERE id = ?`).get(spokenId) as { spoken: string };
  db.prepare(`DELETE FROM script_locks WHERE content_id = ?`).run(guardId);
  db.prepare(`DELETE FROM content_scripts WHERE content_id = ?`).run(guardId);
  db.prepare(`DELETE FROM content_items WHERE id = ?`).run(guardId);
  const proposed = crypto.randomUUID();
  db.prepare(`INSERT INTO style_templates (id, name, description, family, status, created_at, updated_at) VALUES (?, 'Proposed only', 'Not approved', 'CUSTOM', 'proposed', ?, ?)`).run(proposed, new Date().toISOString(), new Date().toISOString());
  const visible = db.prepare(`SELECT COUNT(*) AS n FROM style_templates WHERE id = ? AND status = 'approved'`).get(proposed) as { n: number };
  db.prepare(`DELETE FROM style_templates WHERE id = ?`).run(proposed);
  const legacy = db.prepare(`SELECT COUNT(*) AS n FROM content_items WHERE stage = 'LEGACY'`).get() as { n: number };
  console.log(JSON.stringify({
    id,
    stage: item.stage,
    brand: item.brand,
    title: concept.title,
    conceptStatus: concept.status,
    hook: concept.hook,
    idea: concept.concept,
    audio: script.audio_mode,
    estimated: script.estimated_seconds,
    structure: script.structure_json,
    scriptStatus: script.status,
    spoken: script.spoken || script.voiceover,
    packs: packs.n,
    scriptLocks: lock.n,
    styleBlock: styleBlock(db, item.concept_id),
    productionBlock: productionBlock(db, item.concept_id),
    approvedStyles: styles.n,
    referencesRequired: missing.n,
    promptsDiffer: clay !== indie,
    clayHas: /clay/i.test(clay),
    indieHas: /35mm|skin/i.test(indie),
    paperCritic: styleCriticRules("layered-papercraft"),
    indieCritic: styleCriticRules("australian-indie-35mm"),
    cineplasticCritic: styleCriticRules("cineplastic"),
    visualLockBlocked,
    lockMessage,
    spokenUnchanged: spokenAfter.spoken,
    proposedHidden: visible.n === 0,
    legacyPacks: legacy.n,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
