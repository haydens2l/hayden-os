const ADDRESSED: Array<{ pattern: RegExp; id: string; name: string }> = [
  { pattern: /^(visual director|visual)\s*:/, id: "visual", name: "Visual Director" },
  { pattern: /^(growth strategist|growth)\s*:/, id: "growth", name: "Growth Strategist" },
  { pattern: /^(media director|media)\s*:/, id: "media", name: "Media Director" },
  { pattern: /^(content factory|content)\s*:/, id: "content", name: "Content Factory" },
];

export type AgentSuggestion = {
  id: string;
  name: string;
  reason: string;
};

export function asksForLiveMetric(query: string) {
  return /\bcpl\b|cost per lead|\broas\b|cost per result|live (campaign|ad|meta) performance/.test(query.toLowerCase());
}

export function blockedAction(query: string): "publish_content" | "launch_campaign" | "spend" | null {
  const text = query.toLowerCase();
  if (/publish|post (it|this|the ad)|go live/.test(text)) return "publish_content";
  if (/launch (the |an |a )?(ad|campaign)|turn on (the )?spend/.test(text)) return "launch_campaign";
  if (/\bspend money\b|\bstart spending\b/.test(text)) return "spend";
  return null;
}

export function suggestAgent(query: string): AgentSuggestion {
  const text = query.toLowerCase().trim();
  for (const seat of ADDRESSED) {
    if (seat.pattern.test(text)) return { id: seat.id, name: seat.name, reason: `You addressed ${seat.name}.` };
  }
  if (/visual director|visual direction|visual world|shot plan|make this concept look good|less corporate|what the critic|frames are weak|lock this style|character reference|style reference/.test(text)) {
    return { id: "visual", name: "Visual Director", reason: "This is a visual-direction question. The concept stays with Creative Director." };
  }
  if (/content factory|production pack|start frame|end frame|production brief|scene continuity/.test(text)) {
    return { id: "content", name: "Content Factory", reason: "This is a production-pack question. The concept itself stays with Creative Director." };
  }
  if (asksForLiveMetric(text) || /funnel|offer|conversion|acquisition|experiment|landing page|commercial/.test(text)) {
    return { id: "growth", name: "Growth Strategist", reason: "This is a commercial question. Live performance still needs a connected source." };
  }
  if (/become|series|audience|repeatable|distribution|monetis|beyond street|content pillar/.test(text)) {
    return { id: "media", name: "Media Director", reason: "This is an audience and format question." };
  }
  if (/idea|concept|hook|script|variation|pipeline|funny|storyboard|adapt /.test(text)) {
    return { id: "creative", name: "Creative Director", reason: "This is a creative question." };
  }
  return { id: "chief-of-staff", name: "Chief of Staff", reason: "No specialist is the obvious owner." };
}

export function isBroadTeamRequest(query: string) {
  return /have the team|don'?t make me manage|do not make me manage|come back to me|worth making|worth approving/.test(query.toLowerCase());
}

export function isProductionCommand(query: string) {
  return /visual storyboard|generate (the )?(start and end frames|start \+ end frames|frames)|regenerate scene\b|generate (the )?video|generate (all )?ready scenes|make the video scenes|generate (the )?scene \d+|which scenes are|what'?s missing before|why did scene|how much will it cost|show me the prompt used for scene/i.test(query);
}

export function isTeamQuestion(query: string) {
  const text = query.toLowerCase();
  if (isProductionCommand(query)) return true;
  if (/who should handle/.test(text)) return true;
  if (blockedAction(text)) return true;
  return suggestAgent(query).id !== "chief-of-staff";
}

export function requestedCount(query: string, fallback = 5) {
  const digit = query.match(/\b(\d+)\b/);
  if (digit) return Math.min(12, Math.max(1, Number(digit[1])));
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10 };
  for (const [word, count] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(query)) return count;
  }
  return fallback;
}

export function organisationFor(query: string) {
  const text = query.toLowerCase();
  const brands: Array<[string, RegExp]> = [
    ["property-made-simple", /property made simple|\bpms\b/],
    ["brisbane-collective", /brisbane collective/],
    ["fifo", /\bfifo\b/],
    ["wlth", /\bwlth\b/],
    ["inception", /inception|mortgage calculator|mortgage-free/],
    ["media-empire", /media empire/],
    ["speed-to-lead", /speed to lead/],
  ];
  return brands.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}
