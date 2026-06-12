import { NextResponse } from "next/server";
import { z } from "zod";
import { formatError } from "@/lib/errors";
import { savedLoadTestConfigSchema } from "@/lib/loadtest/store-schema";
import { deleteLoadTest, getLoadTest, publicLoadTest, updateLoadTest } from "@/lib/loadtest/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const test = getLoadTest(id);
  if (!test) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ loadtest: publicLoadTest(test) });
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  config: savedLoadTestConfigSchema.optional(),
});

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!getLoadTest(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
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
    const updated = updateLoadTest(id, parsed.data);
    return NextResponse.json({ loadtest: publicLoadTest(updated!) });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const ok = deleteLoadTest(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
