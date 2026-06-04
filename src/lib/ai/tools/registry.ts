import type { TechId } from "@/lib/connections/types";
import type { PermissionPolicy } from "../permissions";
import { isAllowed } from "../permissions";
import type { AiTool } from "./types";
import { pgTools } from "./postgres";
import { dockerTools } from "./docker";

type Builder = (connectionId: string, config: unknown) => AiTool[];

const BUILDERS: Partial<Record<TechId, Builder>> = {
  postgres: (id, cfg) => pgTools(id, cfg as never),
  docker: (id, cfg) => dockerTools(id, cfg as never),
};

export function isAiSupported(tech: TechId): boolean {
  return tech in BUILDERS;
}

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
