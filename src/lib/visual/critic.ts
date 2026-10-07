import { providerStatus } from "@/lib/ai/provider";

export const CRITIC_DIMENSIONS = [
  "CREATIVE INTENT MATCH",
  "STYLE MATCH",
  "COMPOSITION",
  "STORY READABILITY",
  "CHARACTER CONSISTENCY",
  "ENVIRONMENT CONSISTENCY",
  "CONTINUITY",
  "VISUAL HUMOUR",
  "CAMERA / FRAMING",
  "LIGHTING",
  "PRODUCTION DESIGN",
  "AI ARTIFACTS",
  "TEXT ERRORS",
  "BRAND FIT",
  "CINEMATIC / AESTHETIC QUALITY",
] as const;

export type CriticResultName = "PASS" | "WEAK" | "FAIL" | "NOT APPLICABLE";

export type CriticScore = { result: CriticResultName; evidence: string };

export type CriticReport = {
  ok: boolean;
  model: string | null;
  scores: Record<string, CriticScore>;
  summary: string;
  regenerationPlan: string;
  visibleDetail: string;
  message?: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

const RESULTS = new Set(["PASS", "WEAK", "FAIL", "NOT APPLICABLE"]);

export async function critiqueImage(input: {
  images: Array<{ bytes: Buffer; mimeType: string; label: string }>;
  brief: string;
}): Promise<CriticReport> {
  const status = providerStatus();
  if (!status.connected || status.provider !== "xai" || !status.model) {
    return empty("The Visual Critic needs the connected xAI model. It is not configured.");
  }
  const key = process.env.AI_API_KEY?.trim() ?? "";
  const content: Array<Record<string, string>> = [];
  for (const image of input.images) {
    content.push({ type: "input_text", text: image.label });
    const mime = image.mimeType === "image/png" ? "image/png" : "image/jpeg";
    content.push({ type: "input_image", image_url: `data:${mime};base64,${image.bytes.toString("base64")}`, detail: "high" });
  }
  content.push({
    type: "input_text",
    text: `${input.brief}

Look at the image pixels. Do not grade the prompt.
Return JSON only, with every score key below. Do not omit a key. Do not return a one-key example.
{"scores":{"CREATIVE INTENT MATCH":{"result":"PASS","evidence":""},"STYLE MATCH":{"result":"PASS","evidence":""},"COMPOSITION":{"result":"PASS","evidence":""},"STORY READABILITY":{"result":"PASS","evidence":""},"CHARACTER CONSISTENCY":{"result":"PASS","evidence":""},"ENVIRONMENT CONSISTENCY":{"result":"PASS","evidence":""},"CONTINUITY":{"result":"PASS","evidence":""},"VISUAL HUMOUR":{"result":"PASS","evidence":""},"CAMERA / FRAMING":{"result":"PASS","evidence":""},"LIGHTING":{"result":"PASS","evidence":""},"PRODUCTION DESIGN":{"result":"PASS","evidence":""},"AI ARTIFACTS":{"result":"PASS","evidence":""},"TEXT ERRORS":{"result":"PASS","evidence":""},"BRAND FIT":{"result":"PASS","evidence":""},"CINEMATIC / AESTHETIC QUALITY":{"result":"PASS","evidence":""}},"summary":"","regenerationPlan":"","visibleDetail":"one specific thing you can see"}
Result is PASS, WEAK, FAIL, or NOT APPLICABLE.
Use NOT APPLICABLE only when that dimension cannot be seen (no second image for continuity, no prior character).
If the brief names a medium, score STYLE MATCH from the pixels.
If the brief names a split or other composition, score COMPOSITION from the pixels.
visibleDetail must name something visible, not restate the brief.

CONTINUITY AND CHARACTER CONSISTENCY
Fail these only for a real break: a different person, wrong required wardrobe, wrong required room or world, wrong visual medium, a missing important prop, the wrong side of the frame, lighting or time that contradicts the shot plan, or the wrong story state.
Do not fail because a recurring person changed head position, gaze, hands, posture, expression, or a small body shift.
Words such as stuck, stagnant, same pose, photocopy, or posture match mean the same life and world. They do not require a duplicated pose unless the brief explicitly says the exact pose must remain frozen.
A person who is narratively stuck may still react, move a phone, look at something, and shift where they sit.
If a gaze or pose reading is uncertain, score WEAK, not FAIL. Do not ask for a regeneration on that alone.`,
  });
  let response: Response;
  try {
    response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: status.model, store: false, input: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(180000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && /timeout|abort/i.test(error.name + error.message);
    return empty(timedOut ? "The Visual Critic timed out." : "The Visual Critic could not be reached.");
  }
  const payload = (await response.json().catch(() => null)) as {
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
    output_text?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload) return empty(payload?.error?.message || `The Visual Critic returned ${response.status}.`);
  const text = payload.output_text || payload.output?.flatMap((item) => item.content ?? []).map((part) => part.text ?? "").join("\n") || "";
  const parsed = parseScores(text);
  if (!parsed) return empty("The Visual Critic replied, but the scorecard could not be read.");
  relaxUncertainPoseFails(parsed.scores, input.brief);
  return {
    ok: true,
    model: status.model,
    scores: parsed.scores,
    summary: parsed.summary,
    regenerationPlan: parsed.regenerationPlan,
    visibleDetail: parsed.visibleDetail,
    inputTokens: payload.usage?.input_tokens ?? null,
    outputTokens: payload.usage?.output_tokens ?? null,
  };
}

export function failedDimensions(scores: Record<string, CriticScore>) {
  return Object.entries(scores)
    .filter(([, score]) => score.result === "FAIL")
    .map(([name]) => name);
}

function findScore(scores: Record<string, { result?: string; evidence?: string }>, dimension: string) {
  if (scores[dimension]) return scores[dimension];
  const wanted = dimension.toLowerCase().replace(/[^a-z]/g, "");
  const key = Object.keys(scores).find((item) => item.toLowerCase().replace(/[^a-z]/g, "") === wanted);
  return key ? scores[key] : undefined;
}

function parseScores(text: string): Pick<CriticReport, "scores" | "summary" | "regenerationPlan" | "visibleDetail"> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as {
      scores?: Record<string, { result?: string; evidence?: string }>;
      summary?: string;
      regenerationPlan?: string;
      visibleDetail?: string;
    };
    const scores: Record<string, CriticScore> = {};
    const incoming = value.scores ?? {};
    for (const dimension of CRITIC_DIMENSIONS) {
      const raw = findScore(incoming, dimension);
      const result = String(raw?.result ?? "NOT APPLICABLE").toUpperCase();
      scores[dimension] = {
        result: RESULTS.has(result) ? (result as CriticResultName) : "NOT APPLICABLE",
        evidence: typeof raw?.evidence === "string" ? raw.evidence : "",
      };
    }
    const plan = `${value.summary ?? ""} ${value.regenerationPlan ?? ""}`;
    if (scores["STYLE MATCH"].result === "NOT APPLICABLE" && /photograph|photoreal|live-action|live action/i.test(plan)) {
      scores["STYLE MATCH"] = { result: "FAIL", evidence: value.regenerationPlan || value.summary || "The image was described as photographic." };
    }
    return {
      scores,
      summary: value.summary ?? "",
      regenerationPlan: value.regenerationPlan ?? "",
      visibleDetail: value.visibleDetail ?? "",
    };
  } catch {
    return null;
  }
}

const POSE_CLAIM = /pose|gaze|looking|looks (up|down|left|right|at)|expression|posture|head|mouth|eyes?|hands?|body position|photocopy|duplicate/i;
const REAL_BREAK = /different (man|woman|person|face|shirt|room|world)|recast|not the same (man|woman|person|character)|wrong (person|face|side|room|location|wardrobe|shirt|world)|missing (the )?(remote|phone|keys|split)|no split|photoreal/i;
const FROZEN_POSE = /exact pose must remain frozen|pose must stay frozen|do not change (the |his |her |their )?pose|pixel-identical|identical pose required/i;

function relaxUncertainPoseFails(scores: Record<string, CriticScore>, brief: string) {
  if (FROZEN_POSE.test(brief)) return;
  for (const name of ["CONTINUITY", "CHARACTER CONSISTENCY", "CREATIVE INTENT MATCH"] as const) {
    const score = scores[name];
    if (!score || score.result !== "FAIL") continue;
    if (!POSE_CLAIM.test(score.evidence) || REAL_BREAK.test(score.evidence)) continue;
    score.result = "WEAK";
    score.evidence = `${score.evidence} Pose, gaze, and expression may change unless the lock freezes the exact pose. This did not trigger regeneration.`;
  }
}

function empty(message: string): CriticReport {
  return {
    ok: false,
    model: null,
    scores: {},
    summary: message,
    regenerationPlan: "",
    visibleDetail: "",
    message,
    inputTokens: null,
    outputTokens: null,
  };
}
