import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  deleteDocument,
  findDocuments,
  insertDocument,
  replaceDocument,
} from "@/lib/connections/mongo";
import type { MongoConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; coll: string }>;
}

interface FindBody {
  filter?: string;
  projection?: string;
  sort?: string;
  skip?: number;
  limit?: number;
}

interface InsertBody {
  document: string; // EJSON
}

interface ReplaceBody {
  filter: string; // EJSON
  document: string; // EJSON
}

interface DeleteBody {
  filter: string; // EJSON
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db, coll } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mongo") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const action = req.nextUrl.searchParams.get("action") ?? "find";
  const cfg = record.config as MongoConfig;
  const dbName = decodeURIComponent(db);
  const collName = decodeURIComponent(coll);
  try {
    if (action === "find") {
      const body = (await req.json().catch(() => ({}))) as FindBody;
      const result = await findDocuments(id, cfg, dbName, collName, body);
      return NextResponse.json(result);
    }
    if (action === "insert") {
      const body = (await req.json()) as InsertBody;
      const result = await insertDocument(id, cfg, dbName, collName, body.document);
      return NextResponse.json(result);
    }
    if (action === "replace") {
      const body = (await req.json()) as ReplaceBody;
      const result = await replaceDocument(
        id,
        cfg,
        dbName,
        collName,
        body.filter,
        body.document,
      );
      return NextResponse.json(result);
    }
    if (action === "delete") {
      const body = (await req.json()) as DeleteBody;
      const result = await deleteDocument(id, cfg, dbName, collName, body.filter);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
