import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { removeVolume } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    await removeVolume(
      record.config as DockerConfig,
      decodeURIComponent(name),
      force
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
