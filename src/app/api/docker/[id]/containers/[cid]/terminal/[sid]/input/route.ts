import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/connections/terminal-sessions";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string; sid: string }>;
}

interface Body {
  data?: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { sid } = await ctx.params;
  const session = getSession(sid);
  if (!session) {
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
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
