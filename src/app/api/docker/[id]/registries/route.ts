import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  addRegistry,
  listRegistries,
  publicRegistry,
} from "@/lib/connections/registries";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!getConnection(id)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const registries = listRegistries(id).map(publicRegistry);
  return NextResponse.json({ registries });
}

interface AddBody {
  name?: string;
  serverAddress?: string;
  username?: string;
  password?: string;
  email?: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!getConnection(id)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as AddBody;
  if (
    !body.name?.trim() ||
    !body.serverAddress?.trim() ||
    !body.username?.trim() ||
    body.password == null
  ) {
    return NextResponse.json(
      { error: "name, serverAddress, username, password are required" },
      { status: 400 }
    );
  }
  try {
    const record = addRegistry(id, {
      name: body.name.trim(),
      serverAddress: body.serverAddress.trim(),
      username: body.username.trim(),
      password: body.password,
      email: body.email?.trim() || undefined,
    });
    return NextResponse.json(publicRegistry(record));
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}
