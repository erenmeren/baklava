import type { TechId } from "@/lib/connections/types";
import { TECH_META_LIST } from "@/techs/meta-registry";

export interface PaletteObject {
  label: string;
  sublabel?: string;
  href: string;
  icon?: string;
}

export type ObjectProvider = (
  connectionId: string,
  query: string,
  ctx: { pathname: string; signal?: AbortSignal },
) => Promise<PaletteObject[]>;

export const OBJECT_PROVIDERS: Partial<Record<TechId, ObjectProvider>> =
  Object.fromEntries(
    TECH_META_LIST.filter((m) => m.commandObjects).map((m) => [m.id, m.commandObjects!]),
  );
