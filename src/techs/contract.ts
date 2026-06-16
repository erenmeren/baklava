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

/** Dashboard health probe — wraps the existing per-tech `*Body` functions. */
export type HealthProbe = (conn: ConnectionRecord) => Promise<unknown>;

/** Server-only driver surface. Touches Node-only driver packages, so it lives in
 *  `<tech>/index.ts` (marked `server-only`) and is reached only via the server
 *  `registry.ts` — never from client code. Tech-specific operations (runQuery,
 *  listContainers…) are additional exports from the driver file, imported directly. */
export interface TechDriver<C = unknown> {
  /** Probe the connection. Throws on failure; resolves with tech-specific probe info. */
  probe(config: C): Promise<unknown>;
  /** Dashboard health probe (optional). Server-only. */
  health?: HealthProbe;
}

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

/** Client-safe metadata for a technology. Contains NO driver code, so it is safe
 *  to import from client components (home grid, command palette, connection
 *  sheet…). Lives in `<tech>/meta.ts` and is collected by the client-safe
 *  `meta-registry.ts`. */
export interface TechModuleMeta<C = unknown> {
  id: TechId;
  catalog: TechMeta;
  config: {
    schema: ZodType<C>;
    secretKeys: string[];
    defaults?: Partial<C>;
  };
  /** One-line connection summary for lists/cards. Source for connectionSummaries. */
  summary: (r: ConnectionRecord) => string;
  /** Initial workspace section the tab opens at (""=workspace root). Source for FIRST_PAGE. */
  firstPage: string;
  /** npm packages the driver lazy-imports and may be absent at runtime. When
   *  missing, the driver throws DriverNotInstalledError. A package can appear in
   *  BOTH optionalDeps and serverPackages (e.g. "pg"). */
  optionalDeps: string[];
  /** npm packages that must be listed in next.config.ts `serverExternalPackages`
   *  (native/Node-only deps Turbopack must not bundle). The serverExternalPackages
   *  list is generated from the union of these across all modules. */
  serverPackages?: string[];
  /** Command-palette object provider (client-safe — does fetch()). */
  commandObjects?: ObjectProvider;
  capabilities?: TechCapabilities;
}

/** Full server-side module: client-safe metadata plus the server-only driver.
 *  Lives in `<tech>/index.ts` (marked `server-only`) and is collected by the
 *  server `registry.ts`. */
export interface TechModule<C = unknown> extends TechModuleMeta<C> {
  driver: TechDriver<C>;
}
