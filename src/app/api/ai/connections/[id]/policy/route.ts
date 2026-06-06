import "server-only";
import { NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getPolicy, setPolicy } from "@/lib/ai/policy-store";
import type { PermissionPolicy } from "@/lib/ai/permissions";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getConnection(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ policy: getPolicy(id) });
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getConnection(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = (await req.json()) as PermissionPolicy;
    setPolicy(id, {
      mode: body.mode === "autonomous" ? "autonomous" : "confirm",
      read: body.read !== false,
      write: Boolean(body.write),
      destructive: Boolean(body.destructive),
      confirmDestructive: body.confirmDestructive,
      allowK8sSecretValues: Boolean(body.allowK8sSecretValues),
    });
    return NextResponse.json({ policy: getPolicy(id) });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
