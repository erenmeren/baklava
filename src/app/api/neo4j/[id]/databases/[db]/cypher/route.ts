import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { runCypher, type CypherMode } from "@/lib/connections/neo4j";
import type { Neo4jConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

interface RunBody {
  query: string;
  params?: Record<string, unknown>;
  mode: CypherMode;
}

// Cypher write operations that the server must refuse when mode === 'read'.
// We err on the side of refusing anything that even looks like a mutation
// keyword. Users wanting to write must explicitly toggle the Write switch.
const WRITE_KEYWORDS = [
  "CREATE",
  "MERGE",
  "DELETE",
  "DETACH",
  "SET",
  "REMOVE",
  "DROP",
  "CALL\\s+\\{[^}]*(?:CREATE|MERGE|DELETE|SET|REMOVE)",
  "FOREACH",
  "LOAD\\s+CSV",
];

function looksLikeWrite(query: string): boolean {
  // Strip block + line comments so a `// CREATE` in a comment doesn't trip us.
  const stripped = query
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  const re = new RegExp(`\\b(?:${WRITE_KEYWORDS.join("|")})\\b`, "i");
  return re.test(stripped);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "neo4j") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (!query) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  const mode: CypherMode = body.mode === "write" ? "write" : "read";

  // Safety gate: read-mode rejects anything that looks like a mutation,
  // BEFORE we even touch the database. The driver's executeRead would also
  // refuse to commit, but failing fast here gives a clearer error message
  // and avoids a wasted round-trip.
  if (mode === "read" && looksLikeWrite(query)) {
    return NextResponse.json(
      {
        error:
          "Read mode is on. Toggle to Write mode to execute statements that modify the graph.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await runCypher(
      record.config as Neo4jConfig,
      decodeURIComponent(db),
      query,
      body.params,
      mode
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = formatError(err);
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
