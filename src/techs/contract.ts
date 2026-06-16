import type { ZodType } from "zod";
import type { ConnectionRecord, TechId } from "@/lib/connections/types";
import type { TechMeta } from "@/lib/tech-catalog";
import type { ObjectProvider } from "@/lib/command-palette/object-providers";

export type BaseConfig = Record<string, unknown>;

/** Thrown by a tech driver when its optional npm package is not installed. */
export class DriverNotInstalledError extends Error {
  constructor(
    public readonly tech: TechId,
    public readonly pkg: string,
  ) {
    super(`The "${tech}" driver requires the "${pkg}" package, which is not installed. Run: npm i ${pkg}`);
    this.name = "DriverNotInstalledError";
  }
}

/** The only operation the contract guarantees. Tech-specific operations live as
 *  additional exports from the module's driver file and are imported directly. */
export interface TechDriver<C = unknown> {
  /** Probe the connection. Throws on failure; resolves with tech-specific probe info. */
  probe(config: C): Promise<unknown>;
}

/** Dashboard health probe — wraps the existing per-tech `*Body` functions. */
export type HealthProbe = (conn: ConnectionRecord) => Promise<unknown>;

/** Declarative feature flags so the UI can adapt generically instead of using
 *  per-tech conditionals. Absent flag = false. Forward-looking flags
 *  (vectorSearch, graphTraversal) are intentional: they let future techs slot in
 *  without contract churn. */
export interface TechCapabilities {
  /** Can list/inspect top-level objects (tables, topics, keys, buckets…). */
  browse?: boolean;
  /** Has a query/console editor (SQL, redis-cli, mongo find…). */
  query?: boolean;
  /** Supports uploading objects (blob/storage techs). */
  upload?: boolean;
  /** Offers a tree-style hierarchical navigator (distinct from a flat browse list). */
  objectExplorer?: boolean;
  /** Supports vector similarity search (future vector DBs). */
  vectorSearch?: boolean;
  /** Supports graph traversal queries (future graph DBs). */
  graphTraversal?: boolean;
  /** Participates in dashboard health probes. Should mirror the presence of the module's `health` probe function. */
  health?: boolean;
}

export interface TechModule<C = unknown> {
  id: TechId;
  catalog: TechMeta;
  config: {
    schema: ZodType<C>;
    secretKeys: string[];
    defaults?: Partial<C>;
  };
  driver: TechDriver<C>;
  /** One-line connection summary for lists/cards. Becomes the source for
   *  connectionSummaries in summaries.ts once the registry is wired. */
  summary: (r: ConnectionRecord) => string;
  /** Initial workspace section the tab opens at (""=workspace root). Becomes the
   *  source for FIRST_PAGE in first-page.ts once the registry is wired. */
  firstPage: string;
  /** npm packages the driver lazy-imports and may be absent at runtime. When
   *  missing, the driver throws DriverNotInstalledError. A package can appear in
   *  BOTH optionalDeps and serverPackages (e.g. "pg"). */
  optionalDeps: string[];
  /** npm packages that must be listed in next.config.ts `serverExternalPackages`
   *  (native/Node-only deps Turbopack must not bundle). The serverExternalPackages
   *  list is generated from the union of these across all modules. */
  serverPackages?: string[];
  health?: HealthProbe;
  commandObjects?: ObjectProvider;
  capabilities?: TechCapabilities;
}
