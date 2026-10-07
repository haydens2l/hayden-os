import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { log } from "@/lib/log";
import { syncDatabase } from "@/lib/db/seed";
import { ensureGpuProof } from "@/lib/db/migrate";
import { ensureVisualIntelligence } from "@/lib/visual/schema";
import { ensureContentFactory } from "@/lib/content/schema";

const globalForDb = globalThis as unknown as { haydenSqlite?: Database.Database };

function databasePath() {
  const configured = process.env.DATABASE_PATH ?? "./data/hayden.db";
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export function getDb() {
  if (globalForDb.haydenSqlite) {
    ensureGpuProof(globalForDb.haydenSqlite);
    ensureVisualIntelligence(globalForDb.haydenSqlite);
    ensureContentFactory(globalForDb.haydenSqlite);
    return globalForDb.haydenSqlite;
  }

  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = path.join(process.cwd(), "src/lib/db/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  syncDatabase(db);

  const organisations = db.prepare("SELECT COUNT(*) AS n FROM organisations").get() as { n: number };
  log.info("database ready", { path: file, organisations: organisations.n });

  globalForDb.haydenSqlite = db;
  return db;
}
