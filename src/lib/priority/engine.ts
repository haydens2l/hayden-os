export const ATTENTION_CLASSES = ["hayden_now", "hayden_soon", "delegate", "monitor", "ignore"] as const;
export type AttentionClass = (typeof ATTENTION_CLASSES)[number];

export type Factors = {
  financialImpact: number;
  urgency: number;
  strategicImportance: number;
  haydenDependency: number;
  risk: number;
  timeCost: number;
};

export type IgnoreWindow = "nothing" | "slips" | "material";

export type Situation = {
  factors: Factors;
  needsHaydenDecision: boolean;
  humanCanHandle: boolean;
  agentCouldHandle: boolean;
  alreadyHandled: boolean;
  delegated: boolean;
  deferred?: boolean;
  overdue: boolean;
  blocked: boolean;
  highRisk: boolean;
  haydenAuthority: boolean;
  ignore24h: IgnoreWindow;
  manualClassification?: AttentionClass | null;
  overrideReason?: string | null;
};

export type Assessment = {
  classification: AttentionClass;
  score: number;
  reasoning: string;
  factors: Factors;
};

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

export function normaliseFactors(factors: Factors): Factors {
  return {
    financialImpact: clamp(factors.financialImpact),
    urgency: clamp(factors.urgency),
    strategicImportance: clamp(factors.strategicImportance),
    haydenDependency: clamp(factors.haydenDependency),
    risk: clamp(factors.risk),
    timeCost: clamp(factors.timeCost),
  };
}

export function priorityScore(factors: Factors) {
  const scored = normaliseFactors(factors);
  return (
    scored.financialImpact * 3 +
    scored.urgency * 2 +
    scored.strategicImportance * 3 +
    scored.haydenDependency * 2 +
    scored.risk * 2 -
    scored.timeCost
  );
}

/**
 * Classification decides whether Hayden sees the item.
 * The score is stored beside it and does not override this result.
 */
export function classifyAttention(situation: Situation): Assessment {
  const factors = normaliseFactors(situation.factors);
  const score = priorityScore(factors);

  if (situation.manualClassification) {
    return {
      classification: situation.manualClassification,
      score,
      reasoning: situation.overrideReason?.trim() || "Manual override. The numeric score was left in place.",
      factors,
    };
  }

  if (situation.delegated && situation.overdue && situation.blocked) {
    return {
      classification: "hayden_now",
      score,
      reasoning: "This was delegated, then became overdue and blocked. The owner cannot move it, so it comes back.",
      factors,
    };
  }

  if (situation.delegated && situation.overdue && situation.highRisk) {
    return {
      classification: "hayden_now",
      score,
      reasoning: "This was delegated, and it is now overdue and high risk.",
      factors,
    };
  }

  if (situation.delegated && situation.needsHaydenDecision) {
    return {
      classification: "hayden_now",
      score,
      reasoning: "This was delegated, and it now needs a decision only Hayden can make.",
      factors,
    };
  }

  if (situation.delegated) {
    return {
      classification: "delegate",
      score,
      reasoning: "Someone else owns this. It stays off Hayden's list while it is still moving.",
      factors,
    };
  }

  if (situation.deferred && situation.overdue) {
    return {
      classification: "hayden_now",
      score,
      reasoning: "The deferral date has passed, so the decision is back.",
      factors,
    };
  }

  if (situation.deferred) {
    return {
      classification: "hayden_soon",
      score,
      reasoning: "Deferred. It is not this morning's decision.",
      factors,
    };
  }

  if (situation.needsHaydenDecision && (situation.ignore24h === "material" || factors.urgency >= 4)) {
    return {
      classification: "hayden_now",
      score,
      reasoning: "Hayden has to choose. Waiting a day has a real cost, or the deadline is already pressing.",
      factors,
    };
  }

  if (situation.needsHaydenDecision) {
    return {
      classification: "hayden_soon",
      score,
      reasoning: "Hayden has to choose, but ignoring it for 24 hours does not change the outcome.",
      factors,
    };
  }

  if (situation.humanCanHandle && situation.alreadyHandled && factors.haydenDependency <= 2) {
    if (factors.risk >= 3 || score >= 24) {
      return {
        classification: "monitor",
        score,
        reasoning: "The score may be high. The assigned person can still handle it, so Hayden watches rather than takes it.",
        factors,
      };
    }
    return {
      classification: "delegate",
      score,
      reasoning: "The assigned person can handle this. A higher score would not move it onto Hayden's list.",
      factors,
    };
  }

  if (situation.agentCouldHandle && !situation.haydenAuthority && factors.haydenDependency <= 1 && situation.ignore24h === "nothing") {
    return {
      classification: "ignore",
      score,
      reasoning: "Routine work. Hayden does not hold the authority, and a day of silence changes nothing.",
      factors,
    };
  }

  if (situation.haydenAuthority && situation.ignore24h === "material") {
    return {
      classification: "hayden_now",
      score,
      reasoning: "Hayden holds the authority, and waiting 24 hours has a material cost.",
      factors,
    };
  }

  if (situation.haydenAuthority && situation.ignore24h === "slips") {
    return {
      classification: "hayden_soon",
      score,
      reasoning: "Hayden holds the authority. A day's delay slips it. It is not this morning's item.",
      factors,
    };
  }

  if (situation.alreadyHandled && situation.ignore24h !== "material") {
    return {
      classification: "monitor",
      score,
      reasoning: "Someone is already handling it. Hayden does not need to step in.",
      factors,
    };
  }

  if (score < 12 && factors.haydenDependency <= 1) {
    return {
      classification: "ignore",
      score,
      reasoning: "Low score, and Hayden is not required.",
      factors,
    };
  }

  if (factors.haydenDependency >= 4) {
    return {
      classification: "hayden_now",
      score,
      reasoning: "The work cannot move without Hayden.",
      factors,
    };
  }

  if (factors.haydenDependency >= 2) {
    return {
      classification: "hayden_soon",
      score,
      reasoning: "Hayden is involved. It does not belong at the top of this morning.",
      factors,
    };
  }

  return {
    classification: "delegate",
    score,
    reasoning: "This can sit with the owner.",
    factors,
  };
}

export function attentionWindow<T>(items: T[], expanded: boolean) {
  return items.slice(0, expanded ? 5 : 3);
}

export function ignoreWindowFor(factors: Factors, needsHaydenDecision: boolean): IgnoreWindow {
  const scored = normaliseFactors(factors);
  if (needsHaydenDecision && scored.urgency >= 4) return "material";
  if (scored.urgency >= 4 && scored.haydenDependency >= 3) return "material";
  if (scored.urgency >= 3) return "slips";
  return "nothing";
}
