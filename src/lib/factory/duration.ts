/** Conversational pace. Not an announcer read. Used only to flag a mismatch, not to rewrite the line. */
export const WORDS_PER_SECOND = 2.4;

export function estimateSpokenSeconds(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  return Math.round((words.length / WORDS_PER_SECOND) * 10) / 10;
}

export function validateDuration(input: { durationSeconds: number; dialogue: string }) {
  const estimatedSeconds = estimateSpokenSeconds(input.dialogue);
  const ok = estimatedSeconds <= input.durationSeconds + 0.5;
  return {
    ok,
    estimatedSeconds,
    sceneDuration: input.durationSeconds,
    message: ok
      ? "Spoken length fits the scene."
      : `Dialogue likely needs ${estimatedSeconds} seconds in a ${input.durationSeconds}-second scene. Shorten the line, lengthen the scene if the model allows it, or split the scene. The script has not been rewritten.`,
  };
}
