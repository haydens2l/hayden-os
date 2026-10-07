export type ContinuityScene = {
  sceneNumber: number;
  startFrame: string;
  endFrame: string;
  location?: string;
  continuityFrom?: string;
  continuityInto?: string;
};

export type ContinuityIssue = {
  scene: number;
  problem: string;
  recommendedFix: string;
};

const TIMES = ["dawn", "morning", "midday", "afternoon", "dusk", "sunset", "night"];

export function checkContinuity(scenes: ContinuityScene[], options?: { requireFrames?: boolean }): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  const ordered = [...scenes].sort((a, b) => a.sceneNumber - b.sceneNumber);
  for (const scene of ordered) {
    if (!options?.requireFrames) continue;
    if (!scene.startFrame.trim()) {
      issues.push({
        scene: scene.sceneNumber,
        problem: "Start frame is missing.",
        recommendedFix: "Describe the first frame before this scene is sent to generation.",
      });
    }
    if (!scene.endFrame.trim()) {
      issues.push({
        scene: scene.sceneNumber,
        problem: "End frame is missing.",
        recommendedFix: "Describe the last frame so the next scene can continue from it.",
      });
    }
  }
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    issues.push(...propBreaks(current, next));
    issues.push(...timeBreaks(current, next));
    issues.push(...handBreaks(current, next));
  }
  return issues;
}

function propBreaks(current: ContinuityScene, next: ContinuityScene): ContinuityIssue[] {
  const held = heldProps(`${current.endFrame} ${current.continuityInto ?? ""}`);
  const start = `${next.startFrame} ${next.continuityFrom ?? ""}`.toLowerCase();
  return held
    .filter((prop) => start.includes(`no ${prop}`) || start.includes(`without ${prop}`) || start.includes(`missing ${prop}`))
    .map((prop) => ({
      scene: next.sceneNumber,
      problem: `Scene ${current.sceneNumber} ends with ${prop} present. Scene ${next.sceneNumber} begins without it.`,
      recommendedFix: `Keep the ${prop} in the start frame, or add a shot that puts it down.`,
    }));
}

function heldProps(text: string) {
  const found = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/holding (?:a |an |the )?([a-z]{3,})/g)) found.add(match[1]);
  return [...found];
}

function timeBreaks(current: ContinuityScene, next: ContinuityScene): ContinuityIssue[] {
  const from = timeOf(current.endFrame);
  const to = timeOf(next.startFrame);
  if (!from || !to || from === to) return [];
  const bridged = `${current.continuityInto ?? ""} ${next.continuityFrom ?? ""}`.toLowerCase();
  if (bridged.includes(from) && bridged.includes(to)) return [];
  return [
    {
      scene: next.sceneNumber,
      problem: `Scene ${current.sceneNumber} ends in ${from} light. Scene ${next.sceneNumber} starts in ${to} light, with no transition noted.`,
      recommendedFix: "Match the time of day, or write the transition into the continuity notes.",
    },
  ];
}

function timeOf(text: string) {
  const lower = text.toLowerCase();
  return TIMES.find((time) => lower.includes(time)) ?? null;
}

function handBreaks(current: ContinuityScene, next: ContinuityScene): ContinuityIssue[] {
  const end = current.endFrame.toLowerCase();
  const start = next.startFrame.toLowerCase();
  const prop = heldProps(end)[0];
  if (!prop) return [];
  const endHand = end.includes("right hand") ? "right" : end.includes("left hand") ? "left" : null;
  const startHand = start.includes("right hand") ? "right" : start.includes("left hand") ? "left" : null;
  if (!endHand || !startHand || endHand === startHand) return [];
  if (start.includes(`no ${prop}`)) return [];
  return [
    {
      scene: next.sceneNumber,
      problem: `Scene ${current.sceneNumber} ends with ${prop} in the ${endHand} hand. Scene ${next.sceneNumber} starts with it in the ${startHand} hand.`,
      recommendedFix: `Keep the ${prop} in the ${endHand} hand, unless a shot shows the change.`,
    },
  ];
}
