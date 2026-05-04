import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listImages, pullImage } from "@/lib/connections/docker";
import { findCredForRef } from "@/lib/connections/registries";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const images = await listImages(record.config as DockerConfig);
    updateStatus(id, "ok");
    return NextResponse.json({ images });
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { ref?: string };
  if (!body.ref) {
    return NextResponse.json({ error: "ref is required" }, { status: 400 });
  }
  try {
    const cred = findCredForRef(id, body.ref);
    const auth = cred
      ? {
          username: cred.username,
          password: cred.password,
          serveraddress: cred.serverAddress,
          email: cred.email,
        }
      : undefined;
    await pullImage(record.config as DockerConfig, body.ref, auth);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
