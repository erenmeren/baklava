import { NextRequest, NextResponse } from "next/server";
import { probeSupabase } from "@/lib/connections/supabase";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { SupabaseConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: SupabaseConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config?.url || !body?.config?.serviceRoleKey) {
    return NextResponse.json(
      { error: "Project URL and service role key are required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probeSupabase(body.config);
    const record = body.save
      ? saveConnection({
          tech: "supabase",
          name: body.name || "Supabase",
          config: body.config,
          status: "ok",
        })
      : null;
    return NextResponse.json({
      ok: true,
      probe,
      connection: record ? publicView(record) : null,
    });
  } catch (err) {
    const message = formatError(err);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
