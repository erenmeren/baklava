import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/connections/terminal-sessions";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string; sid: string }>;
}

interface Body {
  cols?: number;
  rows?: number;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { sid } = await ctx.params;
  const session = getSession(sid);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  const cols = Math.min(Math.max(Number(body.cols) || 80, 20), 400);
  const rows = Math.min(Math.max(Number(body.rows) || 24, 5), 200);
  try {
    await session.exec.resize({ h: rows, w: cols });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
