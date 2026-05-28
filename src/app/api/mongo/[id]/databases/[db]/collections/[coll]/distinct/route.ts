import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { distinctValues } from "@/lib/connections/mongo";
import type { MongoConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; coll: string }>;
}

interface Body {
  field: string;
  filter?: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db, coll } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mongo") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.field?.trim()) {
    return NextResponse.json({ error: "field is required" }, { status: 400 });
  }
  try {
    const values = await distinctValues(
      id,
      record.config as MongoConfig,
      decodeURIComponent(db),
      decodeURIComponent(coll),
      body.field,
      body.filter,
    );
    return NextResponse.json({ values });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
