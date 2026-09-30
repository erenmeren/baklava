import "server-only";
import { NextResponse } from "next/server";
import { resolvePending } from "@/lib/ai/pending";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    sessionId?: unknown;
    toolCallId?: unknown;
    decision?: unknown;
    confirm?: unknown;
  } | null;
  if (typeof body?.sessionId !== "string" || typeof body.toolCallId !== "string") {
    return NextResponse.json({ ok: false, error: "sessionId and toolCallId are required" }, { status: 400 });
  }
  // Bound to the user who started the turn, and — for high-risk actions — to
  // the typed confirmation, which the server now checks rather than trusting
  // the card's disabled button.
  const result = resolvePending(body.sessionId, body.toolCallId, body.decision === "approve", {
    userId: user.id,
    confirm: typeof body.confirm === "string" ? body.confirm : undefined,
  });
  return NextResponse.json(result);
}
