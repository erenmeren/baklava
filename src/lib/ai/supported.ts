import type { TechId } from "@/lib/connections/types";
export const AI_SUPPORTED_TECHS: TechId[] = ["postgres", "docker", "mysql", "sqlserver", "mongo", "redis", "kafka", "kubernetes", "r2", "minio", "s3"];
export function isAiSupported(tech: TechId): boolean {
  return AI_SUPPORTED_TECHS.includes(tech);
}
