import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/connections/terminal-sessions";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string; sid: string }>;
}

interface Body {
  data?: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, cid, sid } = await ctx.params;
  const session = getSession(sid);
  // Scoped to the connection + container in the path — see the DELETE handler.
  if (!session || session.connectionId !== id || session.containerId !== cid) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (typeof body.data !== "string") {
    return NextResponse.json({ error: "data is required" }, { status: 400 });
  }
  try {
    session.stream.write(body.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: formatError(err) },
      { status: 502 }
    );
  }
}
