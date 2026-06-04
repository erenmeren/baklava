import type { TechId } from "@/lib/connections/types";
import type { PermissionPolicy } from "../permissions";
import { isAllowed } from "../permissions";
import { isAiSupported } from "../supported";
import type { AiTool } from "./types";
import { pgTools } from "./postgres";
import { dockerTools } from "./docker";

export { isAiSupported };

type Builder = (connectionId: string, config: unknown) => AiTool[];

// Phase 1: postgres + docker only. Add techs in Phase 2.
const BUILDERS: Partial<Record<TechId, Builder>> = {
  postgres: (id, cfg) => pgTools(id, cfg as never),
  docker: (id, cfg) => dockerTools(id, cfg as never),
};

/** Build the tool set for a connection, filtered to categories the policy allows. */
export function buildTools(
  tech: TechId,
  connectionId: string,
  config: unknown,
  policy: PermissionPolicy,
): AiTool[] {
  const builder = BUILDERS[tech];
  if (!builder) return [];
  return builder(connectionId, config).filter((t) => isAllowed(t.category, policy));
}
