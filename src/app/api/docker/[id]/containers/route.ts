import { NextRequest, NextResponse } from "next/server";
import {
  createContainer,
  listContainers,
  type CreateContainerInput,
} from "@/lib/connections/docker";
import { getConnection, updateStatus } from "@/lib/connections/store";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const all = req.nextUrl.searchParams.get("all") === "1";
  try {
    const containers = await listContainers(record.config as DockerConfig, all);
    updateStatus(id, "ok");
    return NextResponse.json({ containers });
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
  let body: CreateContainerInput;
  try {
    body = (await req.json()) as CreateContainerInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.image) {
    return NextResponse.json({ error: "image is required" }, { status: 400 });
  }
  try {
    const result = await createContainer(record.config as DockerConfig, body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
