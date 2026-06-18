import { NextRequest } from "next/server";
import { driverNpmStream } from "@/lib/techs/driver-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  return driverNpmStream(req, id, "uninstall");
}
