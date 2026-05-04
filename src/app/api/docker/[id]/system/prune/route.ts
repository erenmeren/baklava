import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { pruneResource } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const VALID = new Set([
  "containers",
  "images",
  "volumes",
  "networks",
  "build",
]);

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { resource?: string };
  if (!body.resource || !VALID.has(body.resource)) {
    return NextResponse.json(
      { error: "resource must be containers|images|volumes|networks|build" },
      { status: 400 }
    );
  }
  try {
    const result = await pruneResource(
      record.config as DockerConfig,
      body.resource as "containers" | "images" | "volumes" | "networks" | "build"
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
