import type { AttentionClass } from "@/lib/priority/engine";

export type EvidenceRef = {
  type: string;
  id: string;
  label: string;
};

export type Recommendation = {
  id: string;
  entityType: string;
  title: string;
  business: string | null;
  organisationId: string | null;
  action: string;
  why: string;
  expectedOutcome: string;
  haydenTime: string;
  nextStep: string;
  originalClassification: string;
  recommendedClassification: AttentionClass;
  changeReason: string | null;
  confidence: "high" | "medium" | "low";
  recommendedOwnerId: string | null;
  recommendedOwnerName: string | null;
  ownerReason: string | null;
  suggestedDeadline: string | null;
  evidence: EvidenceRef[];
  brain: string[];
  reachedHaydenBecause: string;
  rank: number;
  material: boolean;
  dataStatus: string | null;
};

export type HandledLine = {
  who: string;
  what: string;
  note: string;
};

export type IgnoreLine = {
  id: string;
  what: string;
  why: string;
};

export type WatchLine = {
  id: string;
  text: string;
};

export type WeeklyLedger = {
  generatedOn: string;
  haydenAttention: string[];
  delegated: string[];
  blocked: string[];
  opportunities: string[];
  decisions: string[];
  ignored: string[];
};

export type MorningBrief = {
  headline: string;
  moves: Recommendation[];
  changed: string[];
  handled: HandledLine[];
  watching: WatchLine[];
  decisions: Recommendation[];
  opportunities: Recommendation[];
  ignore: IgnoreLine[];
  bottlenecks: string[];
  stale: Array<{ label: string; detail: string }>;
  recommendations: Recommendation[];
  weekly: WeeklyLedger;
  confidence: "high" | "medium" | "low";
  context: {
    counts: Record<string, number>;
    ids: Record<string, string[]>;
  };
};

export const ATTENTION_BUDGET = 3;
export const FEEDBACK_VERDICTS = [
  "useful",
  "not_useful",
  "wrong",
  "already_handled",
  "should_have_been_delegated",
  "seen_earlier",
] as const;

export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];
