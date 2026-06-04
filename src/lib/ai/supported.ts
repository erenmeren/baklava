import type { TechId } from "@/lib/connections/types";
export const AI_SUPPORTED_TECHS: TechId[] = ["postgres", "docker"];
export function isAiSupported(tech: TechId): boolean {
  return AI_SUPPORTED_TECHS.includes(tech);
}
