import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { runCommand } from "@/lib/connections/redis";
import type { RedisConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  args: string[];
}

function serializeReply(reply: unknown): unknown {
  if (reply === null || reply === undefined) return null;
  if (Buffer.isBuffer(reply)) return reply.toString("utf8");
  if (Array.isArray(reply)) return reply.map(serializeReply);
  if (typeof reply === "object" && reply !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(reply as Record<string, unknown>)) {
      out[k] = serializeReply(v);
    }
    return out;
  }
  return reply;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "redis") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.args) || body.args.length === 0) {
    return NextResponse.json(
      { error: "args (string[]) is required" },
      { status: 400 },
    );
  }
  try {
    const reply = await runCommand(id, record.config as RedisConfig, body.args);
    return NextResponse.json({ ok: true, reply: serializeReply(reply) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: formatError(err) },
      { status: 200 },
    );
  }
}
