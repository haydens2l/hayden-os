export const WORK_STAGES = [
  "IDEA",
  "AI WORKING",
  "NEEDS HAYDEN",
  "READY FOR EXECUTION",
  "ASSIGNED",
  "IN PROGRESS",
  "BLOCKED",
  "READY FOR REVIEW",
  "CHANGES REQUESTED",
  "COMPLETE",
  "CANCELLED",
] as const;

export type WorkStage = (typeof WORK_STAGES)[number];

export type WorkItem = {
  id: string;
  sourceType: string;
  sourceId: string;
  organisation: string | null;
  organisationId: string | null;
  project: string | null;
  projectId: string | null;
  title: string;
  objective: string | null;
  ownerType: "human" | "ai" | "unassigned";
  ownerId: string | null;
  ownerName: string | null;
  status: string;
  stage: WorkStage;
  priority: string | null;
  haydenRequired: boolean;
  haydenAction: string | null;
  blockedReason: string | null;
  waitingOn: string | null;
  nextAction: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  outcome: string | null;
  href: string;
};

export const EXECUTORS = ["hayden", "lily", "danny", "ap", "nic"] as const;
export type ExecutorId = (typeof EXECUTORS)[number];

export const STALE_DAYS = {
  assigned: 3,
  inProgress: 5,
  blocked: 3,
  review: 2,
};
