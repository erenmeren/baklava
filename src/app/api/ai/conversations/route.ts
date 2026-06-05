import "server-only";
import { NextResponse } from "next/server";
import { listConversations, createConversation } from "@/lib/ai/conversation-store";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ conversations: listConversations() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { title?: string; connectionIds?: string[] };
    const c = createConversation({
      title: body.title?.trim() || "New chat",
      connectionIds: Array.isArray(body.connectionIds) ? body.connectionIds : [],
    });
    return NextResponse.json({ conversation: c });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
