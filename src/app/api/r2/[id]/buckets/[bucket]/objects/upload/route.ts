import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { uploadObject } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const cfg = rec.config as R2Config;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form" }, { status: 400 });
  }
  const file = form.get("file");
  const key = String(form.get("key") ?? "");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  try {
    // Web ReadableStream → Node Readable for lib-storage streaming.
    const nodeStream = Readable.fromWeb(
      file.stream() as unknown as import("node:stream/web").ReadableStream,
    );
    await uploadObject(
      id,
      cfg,
      bucket,
      key,
      nodeStream,
      file.type || "application/octet-stream",
    );
    return NextResponse.json({ ok: true, key });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
