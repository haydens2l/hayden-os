import { complete } from "@/lib/ai/provider";

export type Draft = {
  ok: boolean;
  text: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  message?: string;
};

type Drafter = (system: string, user: string) => Promise<Draft>;

let override: Drafter | null = null;

export function setTeamDrafter(drafter: Drafter | null) {
  override = drafter;
}

export async function draft(system: string, user: string, temperature = 0.4, timeoutMs = 90000): Promise<Draft> {
  if (override) return override(system, user);
  const result = await complete({ system, user, temperature, timeoutMs });
  if (!result.ok) return { ok: false, text: "", model: null, inputTokens: null, outputTokens: null, message: result.message };
  return {
    ok: true,
    text: result.text,
    model: result.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  };
}

export function parseModelJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
