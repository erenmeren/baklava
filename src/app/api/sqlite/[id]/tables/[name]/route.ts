import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { describeSqliteTable } from "@/lib/connections/sqlite";
import type { SqliteConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

// Coerce SQLite row values into something JSON.stringify can survive. BLOBs
// arrive as Buffers — render them as a short hex preview so they don't blow
// up the response.
function safeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array || Buffer.isBuffer(v as Buffer)) {
    const buf = Buffer.isBuffer(v) ? (v as Buffer) : Buffer.from(v as Uint8Array);
    const head = buf.subarray(0, 16).toString("hex");
    return `<blob ${buf.length} bytes${buf.length > 0 ? ` 0x${head}${buf.length > 16 ? "…" : ""}` : ""}>`;
  }
  return v;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlite") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const detail = await describeSqliteTable(
      record.config as SqliteConfig,
      decodeURIComponent(name)
    );
    const safe = {
      ...detail,
      data: {
        columns: detail.data.columns,
        rows: detail.data.rows.map((row) => row.map(safeValue)),
      },
    };
    updateStatus(id, "ok");
    return NextResponse.json(safe);
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
