import "server-only";
import { NextResponse } from "next/server";
import { getConversation, updateConversation, deleteConversation } from "@/lib/ai/conversation-store";
import { getConnection } from "@/lib/connections/store";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const c = getConversation(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const connectionIds = c.connectionIds.filter((cid) => getConnection(cid));
  return NextResponse.json({ conversation: { ...c, connectionIds } });
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getConversation(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = (await req.json()) as { title?: string; connectionIds?: string[] };
    const c = updateConversation(id, { title: body.title, connectionIds: body.connectionIds });
    return NextResponse.json({ conversation: c });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return NextResponse.json({ ok: deleteConversation(id) });
}
