import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  createSqlServerSequence,
  type CreateSqlServerSequenceInput,
} from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: Partial<CreateSqlServerSequenceInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await createSqlServerSequence(
      record.config as SqlServerConfig,
      decodeURIComponent(db),
      {
        schema: body.schema ?? "dbo",
        name: body.name ?? "",
        dataType: body.dataType,
        startWith: body.startWith,
        incrementBy: body.incrementBy,
        minValue: body.minValue,
        maxValue: body.maxValue,
        cycle: body.cycle,
        cache: body.cache,
      },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
