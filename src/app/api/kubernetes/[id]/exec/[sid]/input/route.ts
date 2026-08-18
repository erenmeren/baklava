import { NextRequest, NextResponse } from "next/server";
import { getExecSession } from "@/lib/connections/kubernetes-sessions";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; sid: string }>;
}

interface InputBody {
  /** Base64-encoded stdin bytes. */
  data: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, sid } = await ctx.params;
  const session = getExecSession(sid);
  // Scoped to the connection in the path — see the DELETE handler's note.
  if (!session || session.connectionId !== id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.closed) {
    return NextResponse.json({ error: "Session closed" }, { status: 410 });
  }
  let body: InputBody;
  try {
    body = (await req.json()) as InputBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.data !== "string") {
    return NextResponse.json(
      { error: "data must be base64 string" },
      { status: 400 },
    );
  }
  try {
    session.stdin.write(Buffer.from(body.data, "base64"));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
