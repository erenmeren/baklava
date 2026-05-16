import neo4j, {
  type Driver,
  type Session,
  type SessionConfig,
  isInt,
  isNode,
  isRelationship,
  isPath,
  isPathSegment,
  type Integer,
} from "neo4j-driver";
import type { Neo4jConfig } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Driver lifecycle
//
// neo4j-driver maintains a Bolt connection pool that lives until driver.close()
// is awaited — leaving it open causes the Node process to hang on shutdown and
// accumulates leaked sockets across HMR cycles. So every helper opens its own
// driver inside withSession and *always* closes both session and driver in a
// finally block.
// ─────────────────────────────────────────────────────────────────────────────

function buildDriver(config: Neo4jConfig): Driver {
  return neo4j.driver(
    config.uri,
    neo4j.auth.basic(config.user, config.password),
    {
      connectionTimeout: 8000,
      maxConnectionPoolSize: 5,
      // Keep things quiet — neo4j-driver logs to console.warn by default.
      logging: { level: "error", logger: () => {} },
    }
  );
}

async function withSession<T>(
  config: Neo4jConfig,
  database: string | undefined,
  fn: (session: Session) => Promise<T>
): Promise<T> {
  const driver = buildDriver(config);
  const sessionConfig: SessionConfig = database ? { database } : {};
  const session = driver.session(sessionConfig);
  try {
    return await fn(session);
  } finally {
    await session.close().catch(() => undefined);
    await driver.close().catch(() => undefined);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Value conversion
//
// Neo4j returns Integer (a 64-bit value emulated as { low, high }) for any
// counted/identifier column. JSON.stringify of that object yields `{low,high}`
// rather than a number, which would be useless in the UI. We unwrap to a
// JS number when safe and fall back to the string representation otherwise
// (which preserves precision for values above MAX_SAFE_INTEGER).
// ─────────────────────────────────────────────────────────────────────────────

export type CypherValue =
  | string
  | number
  | boolean
  | null
  | CypherValue[]
  | { [key: string]: CypherValue }
  | {
      __type: "Node";
      identity: string;
      elementId: string;
      labels: string[];
      properties: Record<string, CypherValue>;
    }
  | {
      __type: "Relationship";
      identity: string;
      elementId: string;
      type: string;
      start: string;
      end: string;
      properties: Record<string, CypherValue>;
    }
  | {
      __type: "Path";
      start: CypherValue;
      end: CypherValue;
      segments: {
        start: CypherValue;
        relationship: CypherValue;
        end: CypherValue;
      }[];
    }
  | {
      __type: "Integer";
      value: string;
    }
  | {
      __type: "Unknown";
      value: string;
    };

function intToValue(v: Integer): number | { __type: "Integer"; value: string } {
  if (neo4j.integer.inSafeRange(v)) return neo4j.integer.toNumber(v);
  return { __type: "Integer", value: v.toString() };
}

function toIdentityString(v: unknown): string {
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (isInt(v as Integer)) {
    const i = v as Integer;
    if (neo4j.integer.inSafeRange(i)) return String(neo4j.integer.toNumber(i));
    return i.toString();
  }
  return String(v);
}

function convertProperties(
  props: Record<string, unknown>
): Record<string, CypherValue> {
  const out: Record<string, CypherValue> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = convertValue(v);
  }
  return out;
}

export function convertValue(v: unknown): CypherValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : { __type: "Integer", value: String(v) };
  }
  if (typeof v === "bigint") return { __type: "Integer", value: v.toString() };
  if (isInt(v as Integer)) return intToValue(v as Integer);
  if (Array.isArray(v)) return v.map(convertValue);
  if (isNode(v)) {
    const node = v as unknown as {
      identity: unknown;
      elementId: string;
      labels: string[];
      properties: Record<string, unknown>;
    };
    return {
      __type: "Node",
      identity: toIdentityString(node.identity),
      elementId: node.elementId,
      labels: node.labels,
      properties: convertProperties(node.properties),
    };
  }
  if (isRelationship(v)) {
    const rel = v as unknown as {
      identity: unknown;
      elementId: string;
      type: string;
      start: unknown;
      end: unknown;
      properties: Record<string, unknown>;
    };
    return {
      __type: "Relationship",
      identity: toIdentityString(rel.identity),
      elementId: rel.elementId,
      type: rel.type,
      start: toIdentityString(rel.start),
      end: toIdentityString(rel.end),
      properties: convertProperties(rel.properties),
    };
  }
  if (isPath(v)) {
    const path = v as unknown as {
      start: unknown;
      end: unknown;
      segments: { start: unknown; relationship: unknown; end: unknown }[];
    };
    return {
      __type: "Path",
      start: convertValue(path.start),
      end: convertValue(path.end),
      segments: path.segments.map((s) => ({
        start: convertValue(s.start),
        relationship: convertValue(s.relationship),
        end: convertValue(s.end),
      })),
    };
  }
  if (isPathSegment(v)) {
    const seg = v as unknown as {
      start: unknown;
      relationship: unknown;
      end: unknown;
    };
    return {
      __type: "Path",
      start: convertValue(seg.start),
      end: convertValue(seg.end),
      segments: [
        {
          start: convertValue(seg.start),
          relationship: convertValue(seg.relationship),
          end: convertValue(seg.end),
        },
      ],
    };
  }
  // Temporal/spatial/Duration types — they stringify cleanly.
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    // Generic POJO (e.g. a returned map literal).
    const plain: Record<string, CypherValue> = {};
    for (const [k, val] of Object.entries(obj)) {
      plain[k] = convertValue(val);
    }
    return plain;
  }
  return { __type: "Unknown", value: String(v) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe
// ─────────────────────────────────────────────────────────────────────────────

export interface Neo4jProbeResult {
  name: string;
  versions: string[];
  edition: string;
  address?: string;
  defaultDatabase?: string;
}

export async function probeNeo4j(
  config: Neo4jConfig
): Promise<Neo4jProbeResult> {
  return withSession(config, undefined, async (session) => {
    let name = "Neo4j";
    let versions: string[] = [];
    let edition = "unknown";
    try {
      const compRes = await session.run(
        "CALL dbms.components() YIELD name, versions, edition"
      );
      const row = compRes.records[0];
      if (row) {
        name = row.get("name") as string;
        versions = (row.get("versions") as string[]) ?? [];
        edition = row.get("edition") as string;
      }
    } catch {
      // Older Neo4j / missing privileges — at least confirm we can run a query.
      await session.run("RETURN 1");
    }
    let address: string | undefined;
    let defaultDatabase: string | undefined;
    try {
      const res = await session.run(
        "SHOW DEFAULT DATABASE YIELD name, address"
      );
      const row = res.records[0];
      if (row) {
        defaultDatabase = row.get("name") as string;
        const addr = row.get("address");
        if (typeof addr === "string") address = addr;
      }
    } catch {
      // SHOW DEFAULT DATABASE requires Neo4j 4+ and admin privs. Best-effort.
    }
    return { name, versions, edition, address, defaultDatabase };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Databases
// ─────────────────────────────────────────────────────────────────────────────

export interface Neo4jDatabaseSummary {
  name: string;
  address?: string;
  role?: string;
  requestedStatus?: string;
  currentStatus?: string;
  default: boolean;
  home: boolean;
}

function sortDatabases(rows: Neo4jDatabaseSummary[]): Neo4jDatabaseSummary[] {
  return [...rows].sort((a, b) => {
    // system always last
    if (a.name === "system" && b.name !== "system") return 1;
    if (b.name === "system" && a.name !== "system") return -1;
    // default first
    if (a.default && !b.default) return -1;
    if (b.default && !a.default) return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function listNeo4jDatabases(
  config: Neo4jConfig
): Promise<Neo4jDatabaseSummary[]> {
  return withSession(config, "system", async (session) => {
    const res = await session.run("SHOW DATABASES");
    const rows: Neo4jDatabaseSummary[] = [];
    const seen = new Set<string>();
    for (const r of res.records) {
      const name = r.get("name") as string;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      rows.push({
        name,
        address: safeString(r, "address"),
        role: safeString(r, "role"),
        requestedStatus: safeString(r, "requestedStatus"),
        currentStatus: safeString(r, "currentStatus"),
        default: safeBool(r, "default"),
        home: safeBool(r, "home"),
      });
    }
    return sortDatabases(rows);
  });
}

function safeString(record: { has: (k: string) => boolean; get: (k: string) => unknown }, key: string): string | undefined {
  if (!record.has(key)) return undefined;
  const v = record.get(key);
  return typeof v === "string" ? v : undefined;
}

function safeBool(record: { has: (k: string) => boolean; get: (k: string) => unknown }, key: string): boolean {
  if (!record.has(key)) return false;
  const v = record.get(key);
  return v === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview (server + databases summary)
// ─────────────────────────────────────────────────────────────────────────────

export interface Neo4jOverview {
  server: {
    name: string;
    versions: string[];
    edition: string;
    address?: string;
  };
  databases: Neo4jDatabaseSummary[];
  totals: {
    onlineDatabases: number;
    totalNodes: number;
    totalRelationships: number;
    totalIndexes: number;
  };
}

export async function getNeo4jOverview(
  config: Neo4jConfig
): Promise<Neo4jOverview> {
  const probe = await probeNeo4j(config);
  const databases = await listNeo4jDatabases(config);

  let totalNodes = 0;
  let totalRelationships = 0;
  let totalIndexes = 0;
  let onlineDatabases = 0;

  for (const db of databases) {
    if (db.currentStatus !== "online" || db.name === "system") continue;
    onlineDatabases += 1;
    try {
      const { nodes, rels, indexes } = await withSession(
        config,
        db.name,
        async (session) => {
          const [nodesRes, relsRes, indexesRes] = await Promise.all([
            session.run("MATCH (n) RETURN count(n) AS c"),
            session.run("MATCH ()-[r]->() RETURN count(r) AS c"),
            session
              .run("SHOW INDEXES YIELD name RETURN count(name) AS c")
              .catch(() => null),
          ]);
          const nc = nodesRes.records[0]?.get("c");
          const rc = relsRes.records[0]?.get("c");
          const ic = indexesRes?.records[0]?.get("c");
          return {
            nodes: integerToNumber(nc),
            rels: integerToNumber(rc),
            indexes: integerToNumber(ic ?? 0),
          };
        }
      );
      totalNodes += nodes;
      totalRelationships += rels;
      totalIndexes += indexes;
    } catch {
      // Skip stats for databases we can't reach (offline mid-flight etc.)
    }
  }

  // Count system DB online too (just for completeness in the tile)
  onlineDatabases = databases.filter(
    (d) => d.currentStatus === "online"
  ).length;

  return {
    server: {
      name: probe.name,
      versions: probe.versions,
      edition: probe.edition,
      address: probe.address,
    },
    databases,
    totals: {
      onlineDatabases,
      totalNodes,
      totalRelationships,
      totalIndexes,
    },
  };
}

function integerToNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (isInt(v as Integer)) {
    const i = v as Integer;
    return neo4j.integer.inSafeRange(i) ? neo4j.integer.toNumber(i) : Number(i.toString());
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database detail
// ─────────────────────────────────────────────────────────────────────────────

export interface Neo4jLabelStat {
  label: string;
  count: number;
}

export interface Neo4jRelTypeStat {
  type: string;
  count: number;
}

export interface Neo4jIndexInfo {
  name: string;
  type: string;
  state?: string;
  uniqueness?: string;
  entityType?: string;
  labelsOrTypes: string[];
  properties: string[];
  owningConstraint?: string;
}

export interface Neo4jConstraintInfo {
  name: string;
  type: string;
  entityType?: string;
  labelsOrTypes: string[];
  properties: string[];
}

export interface Neo4jDatabaseDetail {
  name: string;
  status?: string;
  totals: {
    nodes: number;
    relationships: number;
  };
  labels: Neo4jLabelStat[];
  relationshipTypes: Neo4jRelTypeStat[];
  indexes: Neo4jIndexInfo[];
  constraints: Neo4jConstraintInfo[];
}

/**
 * Per-label counts. Looping `MATCH (n:Label)` works on any Neo4j but can be
 * slow on huge graphs; we cap the number of labels we count to keep this
 * deterministic. The remaining labels are still returned with count = -1
 * so the UI can render them without a number.
 */
const LABEL_COUNT_CAP = 20;

export async function describeNeo4jDatabase(
  config: Neo4jConfig,
  database: string
): Promise<Neo4jDatabaseDetail> {
  return withSession(config, database, async (session) => {
    const [
      labelsRes,
      typesRes,
      indexesRes,
      constraintsRes,
      nodeCountRes,
      relCountRes,
    ] = await Promise.all([
      session.run("CALL db.labels() YIELD label RETURN label"),
      session.run(
        "CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType"
      ),
      session.run("SHOW INDEXES").catch(() => null),
      session.run("SHOW CONSTRAINTS").catch(() => null),
      session.run("MATCH (n) RETURN count(n) AS c"),
      session.run("MATCH ()-[r]->() RETURN count(r) AS c"),
    ]);

    const labels = labelsRes.records.map((r) => r.get("label") as string);
    const relTypes = typesRes.records.map(
      (r) => r.get("relationshipType") as string
    );

    // Per-label counts (capped). For an empty graph this is fast and safe;
    // for a 100M-node graph the user is expected to set up DB stats elsewhere.
    const labelStats: Neo4jLabelStat[] = [];
    const labelsToCount = labels.slice(0, LABEL_COUNT_CAP);
    const countResults = await Promise.all(
      labelsToCount.map((label) =>
        session
          .run(`MATCH (n:\`${escapeBackticks(label)}\`) RETURN count(n) AS c`)
          .then((res) => integerToNumber(res.records[0]?.get("c")))
          .catch(() => -1)
      )
    );
    for (let i = 0; i < labelsToCount.length; i++) {
      labelStats.push({ label: labelsToCount[i]!, count: countResults[i] ?? -1 });
    }
    for (let i = LABEL_COUNT_CAP; i < labels.length; i++) {
      labelStats.push({ label: labels[i]!, count: -1 });
    }
    labelStats.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    // Per-relationship-type counts (also capped for the same reason).
    const relStats: Neo4jRelTypeStat[] = [];
    const typesToCount = relTypes.slice(0, LABEL_COUNT_CAP);
    const relCounts = await Promise.all(
      typesToCount.map((t) =>
        session
          .run(`MATCH ()-[r:\`${escapeBackticks(t)}\`]->() RETURN count(r) AS c`)
          .then((res) => integerToNumber(res.records[0]?.get("c")))
          .catch(() => -1)
      )
    );
    for (let i = 0; i < typesToCount.length; i++) {
      relStats.push({ type: typesToCount[i]!, count: relCounts[i] ?? -1 });
    }
    for (let i = LABEL_COUNT_CAP; i < relTypes.length; i++) {
      relStats.push({ type: relTypes[i]!, count: -1 });
    }
    relStats.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

    const indexes: Neo4jIndexInfo[] = indexesRes
      ? indexesRes.records.map((r) => ({
          name: (r.get("name") as string) ?? "",
          type: safeString(r, "type") ?? "",
          state: safeString(r, "state"),
          uniqueness: safeString(r, "uniqueness"),
          entityType: safeString(r, "entityType"),
          labelsOrTypes: safeStringArray(r, "labelsOrTypes"),
          properties: safeStringArray(r, "properties"),
          owningConstraint: safeString(r, "owningConstraint"),
        }))
      : [];

    const constraints: Neo4jConstraintInfo[] = constraintsRes
      ? constraintsRes.records.map((r) => ({
          name: (r.get("name") as string) ?? "",
          type: safeString(r, "type") ?? "",
          entityType: safeString(r, "entityType"),
          labelsOrTypes: safeStringArray(r, "labelsOrTypes"),
          properties: safeStringArray(r, "properties"),
        }))
      : [];

    return {
      name: database,
      totals: {
        nodes: integerToNumber(nodeCountRes.records[0]?.get("c")),
        relationships: integerToNumber(relCountRes.records[0]?.get("c")),
      },
      labels: labelStats,
      relationshipTypes: relStats,
      indexes,
      constraints,
    };
  });
}

function safeStringArray(
  record: { has: (k: string) => boolean; get: (k: string) => unknown },
  key: string
): string[] {
  if (!record.has(key)) return [];
  const v = record.get(key);
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

function escapeBackticks(s: string): string {
  // Backtick is the only character that can break an identifier quoted by
  // backticks; doubling it is Cypher's standard escape (analogous to `""` in
  // SQL identifiers). We use this only for label / rel-type names that came
  // *from* the database (not user input), so this is belt-and-suspenders.
  return s.replace(/`/g, "``");
}

// ─────────────────────────────────────────────────────────────────────────────
// Cypher query execution
// ─────────────────────────────────────────────────────────────────────────────

export type CypherMode = "read" | "write";

export interface CypherRunResult {
  columns: string[];
  records: Array<Record<string, CypherValue>>;
  truncated: boolean;
  rowCount: number;
  summary: {
    queryType: string;
    resultAvailableAfter: number;
    resultConsumedAfter: number;
    containsUpdates: boolean;
    counters: {
      nodesCreated: number;
      nodesDeleted: number;
      relationshipsCreated: number;
      relationshipsDeleted: number;
      propertiesSet: number;
      labelsAdded: number;
      labelsRemoved: number;
      indexesAdded: number;
      indexesRemoved: number;
      constraintsAdded: number;
      constraintsRemoved: number;
    };
  };
}

const CYPHER_ROW_CAP = 1000;

export async function runCypher(
  config: Neo4jConfig,
  database: string | undefined,
  query: string,
  params: Record<string, unknown> | undefined,
  mode: CypherMode
): Promise<CypherRunResult> {
  return withSession(config, database, async (session) => {
    const work = async (tx: {
      run: (q: string, p?: Record<string, unknown>) => Promise<unknown>;
    }) => {
      return (await tx.run(query, params ?? {})) as Awaited<
        ReturnType<Session["run"]>
      >;
    };
    const res =
      mode === "write"
        ? await session.executeWrite(work)
        : await session.executeRead(work);

    const allRecords = res.records;
    const truncated = allRecords.length > CYPHER_ROW_CAP;
    const slice = allRecords.slice(0, CYPHER_ROW_CAP);

    const columns = slice[0]?.keys.map((k) => String(k)) ?? [];
    const records = slice.map((r) => {
      const obj: Record<string, CypherValue> = {};
      for (const key of r.keys) {
        const k = String(key);
        obj[k] = convertValue(r.get(k));
      }
      return obj;
    });

    const stats = res.summary.counters.updates();

    return {
      columns,
      records,
      truncated,
      rowCount: allRecords.length,
      summary: {
        queryType: res.summary.queryType ?? "",
        resultAvailableAfter: integerToNumber(res.summary.resultAvailableAfter),
        resultConsumedAfter: integerToNumber(res.summary.resultConsumedAfter),
        containsUpdates: res.summary.counters.containsUpdates(),
        counters: {
          nodesCreated: stats.nodesCreated,
          nodesDeleted: stats.nodesDeleted,
          relationshipsCreated: stats.relationshipsCreated,
          relationshipsDeleted: stats.relationshipsDeleted,
          propertiesSet: stats.propertiesSet,
          labelsAdded: stats.labelsAdded,
          labelsRemoved: stats.labelsRemoved,
          indexesAdded: stats.indexesAdded,
          indexesRemoved: stats.indexesRemoved,
          constraintsAdded: stats.constraintsAdded,
          constraintsRemoved: stats.constraintsRemoved,
        },
      },
    };
  });
}
