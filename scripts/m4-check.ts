import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { answerWithKnowledge, promoteDriveKnowledge } from "../src/lib/integrations/google-drive/answer";
import { buildAuthUrl } from "../src/lib/integrations/google-drive/crypto";
import { buildMorningBrief } from "../src/lib/chief/reason";
import { syncDatabase } from "../src/lib/db/seed";
import { connectionStatus, saveConnection, searchDriveFiles, syncApprovedFolders, approveSource } from "../src/lib/integrations/google-drive/store";
import type { DriveItem, DriveReader } from "../src/lib/integrations/google-drive/types";

process.env.DRIVE_TOKEN_KEY ||= "milestone-4-test-key";
process.env.GOOGLE_CLIENT_ID ||= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ||= "super-secret-value";

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
  const file = path.join(os.tmpdir(), `hayden-m4-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  syncDatabase(db);
  return db;
}

const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";

function reader(tree: Record<string, DriveItem[]>, texts: Record<string, string>): DriveReader {
  return {
    async listChildren(parentId: string) {
      return tree[parentId] ?? [];
    },
    async readText(item: DriveItem) {
      const text = texts[item.id];
      return text ? { text, mode: "text" } : { text: null, mode: "metadata" };
    },
  };
}

function loadAiEnv() {
  const text = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const key of ["AI_PROVIDER", "AI_MODEL", "AI_API_KEY"]) {
    const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
    if (match?.[1] && !process.env[key]) process.env[key] = match[1].trim();
  }
}

async function main() {
  loadAiEnv();
  const authUrl = buildAuthUrl("state-1") ?? "";
  check("A auth url uses the read-only scope", authUrl.includes("drive.readonly"), authUrl.slice(0, 180));
  check("A auth url does not carry the client secret", !authUrl.includes("super-secret-value") && !authUrl.includes("client_secret"));

  const oauth = openDb();
  saveConnection(oauth, {
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    email: "hayden@example.com",
    expiry: new Date(Date.now() + 3600_000).toISOString(),
  });
  const status = connectionStatus(oauth);
  const stored = oauth.prepare(`SELECT access_token, refresh_token FROM drive_connections WHERE id = 'google-drive'`).get() as {
    access_token: string;
    refresh_token: string;
  };
  check("A status shows the account", status.accountEmail === "hayden@example.com" && status.status === "connected");
  check("A status object hides tokens", !JSON.stringify(status).includes("secret-access") && !JSON.stringify(status).includes("secret-refresh"));
  check("A stored token is not the raw secret", stored.access_token !== "secret-access" && !stored.access_token.includes("secret-access"));

  const scoped = openDb();
  const tree: Record<string, DriveItem[]> = {
    root: [
      { id: "folder-a", name: "Approved", mimeType: FOLDER },
      { id: "folder-b", name: "Elsewhere", mimeType: FOLDER },
    ],
    "folder-a": [
      { id: "doc-1", name: "Brisbane Collective street interview plan", mimeType: DOC, modifiedTime: "2026-01-01T00:00:00.000Z", webViewLink: "https://drive.google.com/file/d/doc-1/view" },
      { id: "folder-a1", name: "Sub", mimeType: FOLDER },
    ],
    "folder-a1": [
      { id: "doc-2", name: "Notes inside the approved folder", mimeType: DOC, modifiedTime: "2026-02-01T00:00:00.000Z", webViewLink: "https://drive.google.com/file/d/doc-2/view" },
    ],
    "folder-b": [
      { id: "doc-3", name: "Do not index this", mimeType: DOC, modifiedTime: "2026-03-01T00:00:00.000Z", webViewLink: "https://drive.google.com/file/d/doc-3/view" },
    ],
  };
  const texts: Record<string, string> = {
    "doc-1": "Street interviews should be the only format for Brisbane Collective.",
    "doc-2": "A production note inside the approved tree.",
    "doc-3": "This file sits in a folder Hayden did not approve.",
  };
  approveSource(scoped, { folderId: "folder-a", name: "Approved", path: "Approved" });
  await syncApprovedFolders(scoped, reader(tree, texts));
  const names = scoped.prepare(`SELECT name FROM drive_files`).all() as Array<{ name: string }>;
  const indexed = names.map((row) => row.name).join(" | ");
  check("B approved folder and its subfolder are indexed", indexed.includes("street interview plan") && indexed.includes("Notes inside"));
  check("B an unapproved folder is not indexed", !indexed.includes("Do not index"));

  const found = searchDriveFiles(scoped, { query: "Brisbane Collective street interview plan" });
  check("C known document is found", found[0]?.row.name === "Brisbane Collective street interview plan");
  check("C result keeps the Drive link", found[0]?.row.web_url === "https://drive.google.com/file/d/doc-1/view");

  const asked = await answerWithKnowledge(scoped, "What was our plan for Brisbane Collective street interviews?");
  const askedText = `${asked.summary} ${asked.items.map((item) => `${item.title} ${item.detail}`).join(" ")}`;
  console.log("D summary:", asked.summary);
  check("D answer cites the Drive document", asked.items.some((item) => item.title === "Brisbane Collective street interview plan" && item.href?.includes("doc-1")), askedText);

  const unknown = await answerWithKnowledge(scoped, "What is the warehouse door code we agreed?");
  check("E unknown question is refused", /not stored/i.test(unknown.summary), unknown.summary);

  texts["doc-2"] = "Street interviews should be one format among several for Brisbane Collective.";
  tree["folder-a1"][0].name = "Brisbane Collective street interview update";
  tree["folder-a1"][0].modifiedTime = "2026-09-21T00:00:00.000Z";
  await syncApprovedFolders(scoped, reader(tree, texts));
  const conflict = await answerWithKnowledge(scoped, "What was our plan for Brisbane Collective street interviews?");
  const conflictText = `${conflict.summary} ${conflict.items.map((item) => item.title).join(" ")}`;
  check("F conflict names both documents", /street interview plan/i.test(conflictText) && /street interview update/i.test(conflictText), conflictText);
  check("F conflict is stated", /different/i.test(conflict.summary), conflict.summary);

  const beforeKnowledge = scoped.prepare(`SELECT COUNT(*) AS n FROM knowledge`).get() as { n: number };
  const beforeStrategy = JSON.stringify(scoped.prepare(`SELECT id, strategic_priority, growth_intent FROM organisations ORDER BY id`).all());
  let rejected = false;
  try {
    promoteDriveKnowledge(scoped, {
      fileId: found[0].row.id,
      title: "Street interviews",
      content: "Only format.",
      contextType: "STRATEGY",
      approved: false,
    });
  } catch {
    rejected = true;
  }
  check("G promotion without approval is rejected", rejected);
  check("G indexing did not write Business brain", (scoped.prepare(`SELECT COUNT(*) AS n FROM knowledge`).get() as { n: number }).n === beforeKnowledge.n);
  const fileId = (scoped.prepare(`SELECT id FROM drive_files WHERE drive_file_id = 'doc-1'`).get() as { id: string }).id;
  promoteDriveKnowledge(scoped, {
    fileId,
    title: "Street interviews were once the only format",
    content: "Historical note taken from the Drive document.",
    contextType: "HISTORICAL",
    approved: true,
  });
  const afterKnowledge = scoped.prepare(`SELECT source_type, context_type FROM knowledge WHERE title = ?`).get("Street interviews were once the only format") as {
    source_type: string;
    context_type: string;
  };
  check("G approved promotion is stored as Drive knowledge", afterKnowledge?.source_type === "drive" && afterKnowledge.context_type === "HISTORICAL");
  const afterStrategy = JSON.stringify(scoped.prepare(`SELECT id, strategic_priority, growth_intent FROM organisations ORDER BY id`).all());
  check("G promotion does not rewrite organisation strategy", beforeStrategy === afterStrategy);

  texts["doc-1"] = "Street interviews should be the only format for Brisbane Collective. Updated after review.";
  tree["folder-a"][0].modifiedTime = "2026-09-22T00:00:00.000Z";
  await syncApprovedFolders(scoped, reader(tree, texts));
  const updated = scoped.prepare(`SELECT modified_time, content_text FROM drive_files WHERE drive_file_id = 'doc-1'`).get() as {
    modified_time: string;
    content_text: string;
  };
  check("H sync updates the modified time", updated.modified_time === "2026-09-22T00:00:00.000Z", updated.modified_time);
  check("H sync updates the extracted text", updated.content_text.includes("Updated after review"));

  texts["doc-meta"] = "Yesterday Meta CPL was 41.25 and that is the live result.";
  tree["folder-a"].push({
    id: "doc-meta",
    name: "Meta performance yesterday",
    mimeType: DOC,
    modifiedTime: "2026-09-26T00:00:00.000Z",
    webViewLink: "https://drive.google.com/file/d/doc-meta/view",
  });
  await syncApprovedFolders(scoped, reader(tree, texts));
  const meta = await answerWithKnowledge(scoped, "How did Meta perform yesterday?");
  const metaText = `${meta.summary} ${meta.items.map((item) => `${item.title} ${item.detail}`).join(" ")}`;
  check("I meta answer says live data is unavailable", meta.summary === "No live Meta Ads data is connected.", meta.summary);
  check("I a Drive document is not treated as live Meta performance", !metaText.includes("41.25"), metaText);

  const briefDb = openDb();
  briefDb.prepare(
    `INSERT INTO drive_files (
      id, drive_file_id, name, mime_type, modified_time, web_url, indexed_at, last_checked, content_text, index_status
    ) VALUES ('row-1', 'file-1', 'Secret memo', 'text/plain', '2026-09-01', 'https://drive.google.com/file/d/file-1/view', '2026-09-01', '2026-09-01', 'SECRET_DRIVE_BODY', 'indexed')`,
  ).run();
  const brief = buildMorningBrief(briefDb);
  check("morning brief does not pull Drive body text", !JSON.stringify(brief).includes("SECRET_DRIVE_BODY"));

  const clientSource = fs.readFileSync(path.join(process.cwd(), "src/lib/integrations/google-drive/google.ts"), "utf8");
  check("client has no delete or update call", !/files\/.*\/(delete|trash)|method:\s*["']PATCH|method:\s*["']DELETE/.test(clientSource));

  if (failures.length > 0) {
    console.error(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log("\nAll milestone 4 checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
