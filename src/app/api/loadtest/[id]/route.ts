import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatError } from "@/lib/errors";
import { savedLoadTestConfigSchema } from "@/lib/loadtest/store-schema";
import { deleteLoadTest, getLoadTest, publicLoadTest, updateLoadTest } from "@/lib/loadtest/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Load tests are personal. Every handler scopes to the acting user and returns
// 404 (not 403) for someone else's test so its existence isn't leaked. The store
// accessors already return undefined/false for a non-owner, so the 404 falls out
// naturally.

export async function GET(req: Request, ctx: RouteContext) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const test = getLoadTest(id, user.id);
  if (!test) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ loadtest: publicLoadTest(test) });
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  config: savedLoadTestConfigSchema.optional(),
});

export async function PATCH(req: Request, ctx: RouteContext) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  if (!getLoadTest(id, user.id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  try {
    const updated = updateLoadTest(id, user.id, parsed.data);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ loadtest: publicLoadTest(updated) });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const ok = deleteLoadTest(id, user.id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
