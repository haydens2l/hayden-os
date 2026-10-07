import type Database from "better-sqlite3";
import { EXECUTORS, type ExecutorId } from "@/lib/work/types";

export type PersonRecord = {
  id: string;
  name: string;
  role: string | null;
  responsibilities: string | null;
  notes: string | null;
};

export function personRecord(db: Database.Database, id: string) {
  return db.prepare(`SELECT id, name, role, responsibilities, notes FROM people WHERE id = ?`).get(id) as PersonRecord | undefined;
}

export function executorFromText(text: string): ExecutorId | null {
  const value = text.toLowerCase();
  if (/\blily\b/.test(value)) return "lily";
  if (/\bdanny\b/.test(value)) return "danny";
  if (/\bnic\b/.test(value)) return "nic";
  if (/\bap\b/.test(value)) return "ap";
  if (/\bhayden\b|\bto me\b|\bgive this to me\b/.test(value)) return "hayden";
  return null;
}

export function isExecutor(id: string): id is ExecutorId {
  return (EXECUTORS as readonly string[]).includes(id);
}

export function suggestOwner(
  db: Database.Database,
  input: { sourceType: string; productionType?: string | null; title?: string | null },
) {
  const title = `${input.title ?? ""} ${input.productionType ?? ""}`.toLowerCase();
  if (input.sourceType === "production_pack") {
    if (/ai[- ]?video|\bvideo\b/.test(input.productionType ?? "")) {
      const danny = personRecord(db, "danny");
      return {
        ownerId: "danny" as const,
        certain: Boolean(danny),
        reason: danny
          ? "Business Brain says Danny does paid AI-video fulfilment during the initial working period. Creative director is still a hypothesis, not a stored fact."
          : "Danny is not stored as a person.",
      };
    }
    const lily = personRecord(db, "lily");
    return {
      ownerId: "lily" as const,
      certain: Boolean(lily),
      reason: lily
        ? "Business Brain says suitable production goes to Lily. She executes from production-ready instructions."
        : "Lily is not stored as a person.",
    };
  }
  if (/setter|coaching|kpi/.test(title)) {
    const nic = personRecord(db, "nic");
    return {
      ownerId: nic ? ("nic" as const) : null,
      certain: Boolean(nic),
      reason: nic
        ? "Business Brain routes setter performance and coaching to Nic."
        : "Nic is not stored as a person.",
    };
  }
  if (/crm|data hygiene|systems|automation|admin|reporting infrastructure/.test(title)) {
    const ap = personRecord(db, "ap");
    return {
      ownerId: ap ? ("ap" as const) : null,
      certain: Boolean(ap),
      reason: ap
        ? "Business Brain routes operational systems, CRM hygiene, and repeatable admin to AP."
        : "AP is not stored as a person.",
    };
  }
  return {
    ownerId: null,
    certain: false,
    reason: "Business Brain does not name an owner for this. I will not invent a skill.",
  };
}

export function roleNote(db: Database.Database, ownerId: string, sourceType: string) {
  const person = personRecord(db, ownerId);
  if (!person) return "That person is not stored.";
  if (sourceType === "production_pack" && (ownerId === "ap" || ownerId === "nic")) {
    return `Assigned because you said so. Business Brain knows ${person.name} for ${person.role ?? "their stored role"}, not as the default content executor.`;
  }
  return `${person.name}: ${person.role ?? "role not stored"}.`;
}
