import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listAuthUsers } from "@/lib/connections/supabase";
import type { SupabaseConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "supabase") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const page = Math.max(
    1,
    Number(req.nextUrl.searchParams.get("page")) || 1
  );
  const perPageRaw = Number(req.nextUrl.searchParams.get("perPage")) || 50;
  // Clamp perPage to Supabase's accepted range so a hostile/typo'd client can't
  // ask for 100k and balloon the response.
  const perPage = Math.min(200, Math.max(1, perPageRaw));
  try {
    const data = await listAuthUsers(
      record.config as SupabaseConfig,
      page,
      perPage
    );
    updateStatus(id, "ok");
    return NextResponse.json(data);
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
