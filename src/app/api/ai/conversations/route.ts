import "server-only";
import { NextResponse } from "next/server";
import { listConversations, createConversation } from "@/lib/ai/conversation-store";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ conversations: listConversations(user.id) });
}

export async function POST(req: Request) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = (await req.json()) as { title?: string; connectionIds?: string[] };
    const c = createConversation({
      userId: user.id,
      title: body.title?.trim() || "New chat",
      connectionIds: Array.isArray(body.connectionIds) ? body.connectionIds : [],
    });
    return NextResponse.json({ conversation: c });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
