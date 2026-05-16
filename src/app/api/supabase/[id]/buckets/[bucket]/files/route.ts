import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listBucketFiles } from "@/lib/connections/supabase";
import type { SupabaseConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; bucket: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, bucket } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "supabase") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const bucketName = decodeURIComponent(bucket);
  // We accept a `prefix` query param that names the current folder. The
  // Supabase SDK already treats "" as the bucket root; trim a leading slash
  // so a UI breadcrumb that builds "/foo/bar" maps cleanly to "foo/bar".
  const prefix = (req.nextUrl.searchParams.get("prefix") ?? "").replace(
    /^\/+/,
    ""
  );
  try {
    const entries = await listBucketFiles(
      record.config as SupabaseConfig,
      bucketName,
      prefix
    );
    updateStatus(id, "ok");
    return NextResponse.json({ entries, prefix });
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
