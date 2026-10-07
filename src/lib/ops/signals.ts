export type Utterance = { speaker: string; text: string; start?: number };

export type CallSignal = {
  signalType: string;
  speaker: string;
  evidence: string;
  confidence: "high" | "medium";
};

export type AttendanceRead = {
  lead: boolean;
  partner: boolean;
  both: boolean;
  reschedule: boolean;
  timing: boolean;
  bringForward: boolean;
};

const PARTNER_WORD = /\b(wife|husband|partner|spouse)\b/i;
const NEGATIVE = /might not|may not|not sure|can'?t|cannot|won'?t|will not|have to check|need to check|can'?t promise|cannot promise|probably can'?t|don'?t know if|can'?t guarantee/i;
const ATTENDANCE = /make it|attend|get off work|get home|be there|show up|\bjoin\b|the times|the meeting|the appointment/i;
const POSITIVE_SELF = /\b(i can make it|i'?ll make it|i will make it|i can attend|i'?ll attend|i will be able to attend|i'?ll be able to attend)\b/i;
const BRING_FORWARD = /any afternoon|sooner the better|something earlier|most of next week|i'?m around most|if you have something earlier|call me earlier|free earlier|if something comes up earlier|let me know if .{0,40}earlier/i;

export function readAttendance(text: string): AttendanceRead {
  const raw = text.replace(/\s+/g, " ").trim();
  const bringForward = BRING_FORWARD.test(raw) && !/earlier in the year/i.test(raw);
  const reschedule = /reschedul|move the appointment|another day|different day/i.test(raw);
  const both = /\b(we both|both of us|we'?ll both|we will both)\b/i.test(raw) && /check|make it|attend|come/i.test(raw);
  let partner = false;
  let lead = false;
  for (const clause of raw.split(/\s+but\s+|(?<=[.!?])\s+/i)) {
    const otherOffWork = /get off work/i.test(clause) && !/\bi (can'?t|cannot|might not|won'?t) get off work/i.test(clause);
    const hasPartner = PARTNER_WORD.test(clause) || otherOffWork;
    const hasSelf = /\b(i|i'm|i am|i'll|i will)\b/i.test(clause);
    const negative = NEGATIVE.test(clause);
    const attendance = ATTENDANCE.test(clause);
    if (hasPartner && negative && attendance) partner = true;
    if (hasSelf && negative && attendance && !hasPartner && !POSITIVE_SELF.test(clause)) lead = true;
  }
  const partnerUnsure = raw.split(/\s+but\s+|(?<=[.!?])\s+/i).some((clause) => PARTNER_WORD.test(clause) && NEGATIVE.test(clause));
  if (!both && partnerUnsure && ATTENDANCE.test(raw)) partner = true;
  if (POSITIVE_SELF.test(raw)) lead = false;
  if (both) {
    lead = false;
    partner = false;
  }
  const timing = /not sure about (the|that) (day|time|date)|have to check (the|whether the) (day|time|date)/i.test(raw) && !lead && !partner && !both;
  return { lead, partner, both, reschedule, timing, bringForward };
}

export function signalsFromUtterances(utterances: Utterance[]) {
  const found: CallSignal[] = [];
  const seen = new Set<string>();
  for (const utterance of utterances) {
    const text = utterance.text.trim();
    if (!text || utterance.speaker !== "Lead") continue;
    const read = readAttendance(text);
    const types = [
      read.both ? "BOTH_ATTENDANCE_CONCERN" : "",
      read.lead ? "LEAD_ATTENDANCE_CONCERN" : "",
      read.partner ? "PARTNER_ATTENDANCE_CONCERN" : "",
      read.reschedule ? "RESCHEDULE_REQUEST" : "",
      read.timing ? "TIMING_UNCERTAINTY" : "",
      read.bringForward ? "BRING_FORWARD_FLEXIBILITY" : "",
    ].filter(Boolean);
    for (const signalType of types) {
      const key = `${signalType}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ signalType, speaker: utterance.speaker, evidence: text, confidence: "high" });
    }
  }
  return found;
}

export function speakerLabel(participant: string | undefined, agentName: string | null) {
  if (participant === "internal") return agentName || "Agent";
  if (participant === "external") return "Lead";
  return "Speaker not stored";
}

export function signalAction(signalType: string) {
  if (signalType === "PARTNER_ATTENDANCE_CONCERN") return "Confirm the partner can attend.";
  if (signalType === "BOTH_ATTENDANCE_CONCERN") return "Confirm both people can attend.";
  if (signalType === "LEAD_ATTENDANCE_CONCERN") return "Call the lead and check the appointment still stands.";
  if (signalType === "BRING_FORWARD_FLEXIBILITY") return "Ask if an earlier time would help. An earlier slot is not confirmed.";
  if (signalType === "RESCHEDULE_REQUEST" || signalType === "TIMING_UNCERTAINTY") return "Call and confirm the time.";
  return "Read the evidence before acting.";
}
