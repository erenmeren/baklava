import { NextRequest, NextResponse } from "next/server";
import { probeSqlite } from "@/lib/connections/sqlite";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { SqliteConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: SqliteConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const cfg = body?.config;
  if (!cfg?.filePath) {
    return NextResponse.json(
      { error: "filePath is required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probeSqlite(cfg);
    const record = body.save
      ? saveConnection({
          tech: "sqlite",
          name: body.name || "SQLite",
          config: cfg,
          status: "ok",
        })
      : null;
    return NextResponse.json({
      ok: true,
      probe,
      connection: record ? publicView(record) : null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: formatError(err) },
      { status: 200 }
    );
  }
}
