import type { ConnectionRecord, TechId } from "./types";
import { TECH_META } from "@/techs/meta-registry";

export const connectionSummaries: Record<TechId, (r: ConnectionRecord) => string> =
  Object.fromEntries(
    (Object.entries(TECH_META) as [TechId, (typeof TECH_META)[TechId]][]).map(
      ([id, meta]) => [id, meta.summary],
    ),
  ) as Record<TechId, (r: ConnectionRecord) => string>;
