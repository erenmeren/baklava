import { NextRequest, NextResponse } from "next/server";
import { pingDocker } from "@/lib/connections/docker";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: DockerConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config) {
    return NextResponse.json({ error: "Missing config" }, { status: 400 });
  }

  try {
    const info = await pingDocker(body.config);
    const record = body.save
      ? saveConnection({
          tech: "docker",
          name: body.name || "Docker",
          config: body.config,
          status: "ok",
        })
      : null;
    return NextResponse.json({
      ok: true,
      info,
      connection: record ? publicView(record) : null,
    });
  } catch (err) {
    const message = formatError(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 200 }
    );
  }
}
