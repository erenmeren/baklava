import type { TechId } from "./types";

/** The initial section a workspace tab opens at, per tech. Empty = the
 *  workspace root (overview). */
export const FIRST_PAGE: Record<TechId, string> = {
  docker: "containers",
  postgres: "",
  mysql: "",
  kafka: "",
  sqlserver: "",
  kubernetes: "pods",
  redis: "keys",
  mongo: "databases",
  r2: "",
  minio: "",
  s3: "",
};

export function workspaceHref(tech: TechId, id: string): string {
  const seg = FIRST_PAGE[tech];
  return seg ? `/${tech}/${id}/${seg}` : `/${tech}/${id}`;
}
