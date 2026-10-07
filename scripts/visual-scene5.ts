import fs from "node:fs";
import Database from "better-sqlite3";
import { critiqueImage } from "../src/lib/visual/critic";

const id = "6dfbf19e-bf8d-4bc3-84ce-02856a25db41";

async function main() {
  const db = new Database("data/hayden.db");
  db.pragma("journal_mode = WAL");
  const frame = db.prepare(`SELECT storage_location, mime_type, metadata FROM generated_assets WHERE id = ?`).get(id) as {
    storage_location: string;
    mime_type: string | null;
    metadata: string | null;
  };
  const critique = await critiqueImage({
    images: [{ bytes: fs.readFileSync(frame.storage_location), mimeType: frame.mime_type || "image/jpeg", label: "Generated image to judge. One image only." }],
    brief: "Brand: Property Made Simple. Medium: Stylised illustrated / cinematic sketch. Style: Tactile editorial sketch. Required: the split remains. Scene 5 should show him still forecasting while life on the right has moved on to a barbecue. If this is a photograph, STYLE MATCH is FAIL. If there is no left/right split, COMPOSITION is FAIL.",
  });
  db.prepare(`INSERT INTO visual_critiques (id, asset_id, model, scores, summary, regeneration_plan, visible_detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(),
    id,
    critique.model,
    JSON.stringify(critique.scores),
    critique.summary,
    critique.regenerationPlan,
    critique.visibleDetail,
    new Date().toISOString(),
  );
  const fails = Object.entries(critique.scores).filter(([, score]) => score.result === "FAIL").map(([name]) => name);
  const meta = frame.metadata ? (JSON.parse(frame.metadata) as Record<string, unknown>) : {};
  meta.qa = critique.ok && fails.length === 0 ? "pass" : "unresolved";
  meta.referencesSent = 1;
  db.prepare(`UPDATE generated_assets SET metadata = ?, generation_status = 'NEEDS_HAYDEN', error_message = ? WHERE id = ?`).run(
    JSON.stringify(meta),
    critique.ok && fails.length === 0 ? null : critique.ok ? `${fails.join(", ")} failed. ${critique.summary}` : critique.message,
    id,
  );
  console.log(JSON.stringify({ ok: critique.ok, message: critique.message, style: critique.scores["STYLE MATCH"], composition: critique.scores["COMPOSITION"], visible: critique.visibleDetail, fails }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
