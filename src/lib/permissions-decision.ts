import type Database from "better-sqlite3";

export type PermissionLevel = "READ" | "CREATE" | "UPDATE" | "EXECUTE" | "ESCALATE";

export type PermissionDecision = {
  allowed: boolean;
  needsApproval: boolean;
  reason: string;
};

export function decidePermission(db: Database.Database, agentSlug: string, level: PermissionLevel, resource: string): PermissionDecision {
  const row = db
    .prepare(
      `SELECT p.requires_approval AS requires_approval
       FROM agent_permissions p
       JOIN agents a ON a.id = p.agent_id
       WHERE a.slug = ? AND p.level = ? AND (p.resource = ? OR p.resource = '*')
       ORDER BY CASE WHEN p.resource = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(agentSlug, level, resource, resource) as { requires_approval: number } | undefined;

  if (!row) {
    return {
      allowed: false,
      needsApproval: false,
      reason: `${agentSlug} has no ${level} permission on ${resource}.`,
    };
  }

  if (row.requires_approval === 1) {
    return {
      allowed: false,
      needsApproval: true,
      reason: `${agentSlug} may ${level} ${resource} only after a person approves it.`,
    };
  }

  return { allowed: true, needsApproval: false, reason: "Granted." };
}
