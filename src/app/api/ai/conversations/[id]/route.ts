import "server-only";
import { NextResponse } from "next/server";
import { getConversation, updateConversation, deleteConversation } from "@/lib/ai/conversation-store";
import { getConnection } from "@/lib/connections/store";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Conversations are personal. Every handler scopes to the acting user and
// returns 404 (not 403) for someone else's conversation so its existence isn't
// leaked. getConversation/updateConversation/deleteConversation already return
// undefined/false for a non-owner, so the 404 falls out naturally.

export async function GET(req: Request, ctx: Ctx) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const c = getConversation(id, user.id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const connectionIds = c.connectionIds.filter((cid) => getConnection(cid));
  return NextResponse.json({ conversation: { ...c, connectionIds } });
}

export async function PUT(req: Request, ctx: Ctx) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  if (!getConversation(id, user.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = (await req.json()) as { title?: string; connectionIds?: string[] };
    // Trim + cap server-side (the UI guards too, but a direct call shouldn't be
    // able to store an empty or arbitrarily long title). Empty => keep existing.
    const title =
      typeof body.title === "string" ? body.title.trim().slice(0, 120) || undefined : undefined;
    const c = updateConversation(id, { title, connectionIds: body.connectionIds }, user.id);
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ conversation: c });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const ok = deleteConversation(id, user.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok });
}
