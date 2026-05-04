import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getStack, teardownStack } from "@/lib/connections/compose";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const stack = await getStack(
      record.config as DockerConfig,
      decodeURIComponent(name)
    );
    if (!stack) {
      return NextResponse.json({ error: "Stack not found" }, { status: 404 });
    }
    return NextResponse.json(stack);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const removeVolumes = req.nextUrl.searchParams.get("volumes") === "1";
  try {
    await teardownStack(record.config as DockerConfig, decodeURIComponent(name), {
      removeVolumes,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
