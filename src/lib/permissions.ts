import "server-only";

import { getDb } from "@/lib/db/client";
import { decidePermission, type PermissionDecision, type PermissionLevel } from "@/lib/permissions-decision";

export const PERMISSION_LEVELS = ["READ", "CREATE", "UPDATE", "EXECUTE", "ESCALATE"] as const;
export type { PermissionDecision, PermissionLevel };

export const HIGH_RISK_RESOURCES = [
  "spend",
  "launch_campaign",
  "mass_outreach",
  "delete_records",
  "change_financials",
  "publish_content",
] as const;

export function checkPermission(agentSlug: string, level: PermissionLevel, resource: string): PermissionDecision {
  return decidePermission(getDb(), agentSlug, level, resource);
}

export { decidePermission };
