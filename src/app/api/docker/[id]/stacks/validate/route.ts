import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  ComposeParseError,
  parseCompose,
} from "@/lib/connections/compose";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  name?: string;
  compose?: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!getConnection(id)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.name?.trim() || !body.compose?.trim()) {
    return NextResponse.json(
      { error: "name and compose are required" },
      { status: 400 }
    );
  }
  try {
    const parsed = parseCompose(body.name.trim(), body.compose);
    return NextResponse.json({
      ok: true,
      stack: parsed.stack,
      services: parsed.services.map((s) => ({
        name: s.name,
        image: s.image,
        ports: s.ports,
        envCount: s.env.length,
        mounts: s.mounts.length,
        networks: s.networks,
        dependsOn: s.dependsOn,
        restart: s.restart,
      })),
      networks: parsed.networks,
      volumes: parsed.volumes,
      warnings: parsed.warnings,
    });
  } catch (err) {
    if (err instanceof ComposeParseError) {
      return NextResponse.json(
        { ok: false, errors: err.errors },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: false, error: formatError(err) }, { status: 200 });
  }
}
