import type Database from "better-sqlite3";

const BRANDS: Array<{ id: string; name: string; pattern: RegExp }> = [
  { id: "property-made-simple", name: "Property Made Simple", pattern: /property made simple|\bpms\b/i },
  { id: "brisbane-collective", name: "Brisbane Collective", pattern: /brisbane collective/i },
  { id: "fifo", name: "FIFO Investor", pattern: /\bfifo\b/i },
  { id: "wlth", name: "WLTH", pattern: /\bwlth\b/i },
  { id: "inception", name: "Inception Wealth Group", pattern: /\binception\b|\biwg\b/i },
];

export function knownBrand(text: string) {
  return BRANDS.find((brand) => brand.pattern.test(text)) ?? null;
}

export function brandName(db: Database.Database, organisationId: string | null) {
  if (!organisationId) return null;
  const row = db.prepare(`SELECT name FROM organisations WHERE id = ?`).get(organisationId) as { name: string } | undefined;
  return row?.name ?? null;
}

export function resolveBrand(
  db: Database.Database,
  input: { organisationId?: string | null; text?: string | null; storedBrand?: string | null },
) {
  const fromOrg = brandName(db, input.organisationId ?? null);
  if (fromOrg) return { id: input.organisationId ?? null, name: fromOrg, known: true };
  const blob = `${input.text ?? ""} ${input.storedBrand ?? ""}`;
  const named = knownBrand(blob);
  if (named) return { id: named.id, name: named.name, known: true };
  const stored = (input.storedBrand ?? "").trim();
  if (stored && !/unassigned|unknown/i.test(stored)) return { id: input.organisationId ?? null, name: stored, known: true };
  return { id: null, name: "UNKNOWN BRAND", known: false };
}
