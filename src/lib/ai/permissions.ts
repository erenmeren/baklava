export type ToolCategory = "read" | "write" | "destructive";

export interface PermissionPolicy {
  mode: "confirm" | "autonomous";
  read: boolean;
  write: boolean;
  destructive: boolean;
  confirmDestructive?: boolean;
}

export const DEFAULT_POLICY: PermissionPolicy = {
  mode: "confirm",
  read: true,
  write: false,
  destructive: false,
};

export function isAllowed(category: ToolCategory, policy: PermissionPolicy): boolean {
  return policy[category];
}

export function needsApproval(category: ToolCategory, policy: PermissionPolicy): boolean {
  if (category === "read") return false;
  if (policy.mode === "confirm") return true;
  if (category === "destructive") return policy.confirmDestructive !== false;
  return false;
}
