import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { readContainerLogs } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string }>;
}

function parseTail(raw: string | null, fallback: number | "all"): number | "all" {
  if (!raw) return fallback;
  if (raw === "all") return "all";
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), 200_000);
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, cid } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const download = req.nextUrl.searchParams.get("download") === "1";
  const tail = parseTail(
    req.nextUrl.searchParams.get("tail"),
    download ? "all" : 200
  );
  const sinceRaw = req.nextUrl.searchParams.get("since");
  const since = sinceRaw && Number.isFinite(Number(sinceRaw))
    ? Math.floor(Number(sinceRaw))
    : undefined;
  const timestamps = req.nextUrl.searchParams.get("timestamps") === "1";

  try {
    const text = await readContainerLogs(record.config as DockerConfig, cid, {
      tail,
      since,
      timestamps,
    });
    if (download) {
      const filename = `${cid.slice(0, 12)}-${Math.floor(Date.now() / 1000)}.log`;
      return new NextResponse(text, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      });
    }
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
