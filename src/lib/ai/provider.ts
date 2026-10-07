export type ProviderId = "xai" | "openai" | "anthropic";

export type ProviderStatus = {
  connected: boolean;
  provider: ProviderId | null;
  model: string | null;
  message: string;
};

export type CompletionRequest = {
  system: string;
  user: string;
  timeoutMs?: number;
  temperature?: number;
};

export type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type CompletionResult =
  | { ok: true; text: string; provider: ProviderId; model: string; usage: TokenUsage }
  | { ok: false; reason: "not_configured" | "error"; message: string };

const SUPPORTED = "xai, openai, or anthropic";

export function providerStatus(): ProviderStatus {
  const provider = normaliseProvider(process.env.AI_PROVIDER);
  const model = process.env.AI_MODEL?.trim() || "";
  const key = process.env.AI_API_KEY?.trim() || "";
  if (!provider || !model || !key) {
    return {
      connected: false,
      provider,
      model: model || null,
      message: "AI Chief of Staff not connected",
    };
  }
  return {
    connected: true,
    provider,
    model,
    message: `Connected through ${provider}.`,
  };
}

export async function complete(request: CompletionRequest): Promise<CompletionResult> {
  const status = providerStatus();
  if (!status.connected || !status.provider || !status.model) {
    return { ok: false, reason: "not_configured", message: "AI Chief of Staff not connected" };
  }
  const key = process.env.AI_API_KEY?.trim() ?? "";
  try {
    const called = await callProvider(status.provider, status.model, key, request);
    return { ok: true, text: called.text, provider: status.provider, model: status.model, usage: called.usage };
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : "The model request failed.",
    };
  }
}

function normaliseProvider(value: string | undefined): ProviderId | null {
  const token = value?.trim().toLowerCase();
  if (token === "grok" || token === "xai") return "xai";
  if (token === "openai") return "openai";
  if (token === "anthropic") return "anthropic";
  return null;
}

async function callProvider(provider: ProviderId, model: string, key: string, request: CompletionRequest) {
  if (provider === "anthropic") return anthropic(model, key, request);
  const url = provider === "xai" ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: request.temperature ?? 0.2,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    }),
    signal: AbortSignal.timeout(request.timeoutMs ?? 20000),
  });
  if (!response.ok) throw new Error(`${provider} returned ${response.status}.`);
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${provider} returned an empty response.`);
  return { text, usage: readUsage(body.usage) };
}

async function anthropic(model: string, key: string, request: CompletionRequest) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      temperature: 0.2,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
    }),
    signal: AbortSignal.timeout(request.timeoutMs ?? 20000),
  });
  if (!response.ok) throw new Error(`anthropic returned ${response.status}.`);
  const body = (await response.json()) as {
    content?: Array<{ text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = body.content?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("anthropic returned an empty response.");
  return {
    text,
    usage: {
      inputTokens: typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : null,
      outputTokens: typeof body.usage?.output_tokens === "number" ? body.usage.output_tokens : null,
    },
  };
}

function readUsage(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): TokenUsage {
  return {
    inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
  };
}

export function providerSetup() {
  return {
    file: ".env",
    variables: ["AI_PROVIDER", "AI_MODEL", "AI_API_KEY"],
    providers: SUPPORTED,
  };
}
