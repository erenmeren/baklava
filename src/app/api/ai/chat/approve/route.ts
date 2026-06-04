import "server-only";
import { NextResponse } from "next/server";
import { resolvePending } from "@/lib/ai/pending";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { sessionId, toolCallId, decision } = (await req.json()) as {
    sessionId: string;
    toolCallId: string;
    decision: "approve" | "reject";
  };
  const ok = resolvePending(sessionId, toolCallId, decision === "approve");
  return NextResponse.json({ ok });
}
