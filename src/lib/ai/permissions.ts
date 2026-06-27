export type ToolCategory = "read" | "write" | "destructive";

export interface PermissionPolicy {
  mode: "confirm" | "autonomous";
  read: boolean;
  write: boolean;
  destructive: boolean;
  /**
   * Kept for back-compat but no longer has any effect: destructive actions
   * always require approval regardless of this flag (non-disableable).
   */
  confirmDestructive?: boolean;
  /**
   * Kubernetes only: when true, k8s_get_yaml returns Secret values verbatim.
   * Default (false/undefined) redacts Secret data/stringData. Not a category —
   * isAllowed/needsApproval ignore it.
   */
  allowK8sSecretValues?: boolean;
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
  if (category === "destructive") return true; // non-disableable: destructive always confirms
  return policy.mode === "confirm"; // write
}
