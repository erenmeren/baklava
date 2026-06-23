import { NextRequest, NextResponse } from "next/server";
import { isAuthEnabled, setAuthEnabled } from "@/lib/auth/store";

export const runtime = "nodejs";

// Reaching this route already requires a valid session whenever the gate is
// enabled (enforced by proxy.ts) — so the gate can only be turned OFF by an
// authenticated user. Turning it back ON is always allowed (it only adds
// protection); the user is sent to /login afterwards.

export async function GET() {
  return NextResponse.json({ enabled: isAuthEnabled() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "`enabled` must be a boolean" },
      { status: 400 },
    );
  }
  setAuthEnabled(body.enabled);
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
