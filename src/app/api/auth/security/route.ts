import { NextRequest, NextResponse } from "next/server";
import { isAuthEnabled, setAuthEnabled } from "@/lib/auth/store";
import { authErrorResponse, requireAdmin } from "@/lib/auth/current-user";

export const runtime = "nodejs";

// Turning the gate OFF makes every visitor the synthetic local admin, so only an
// admin may flip it. While the gate is already off, getCurrentUser returns that
// synthetic admin, so turning it back ON keeps working.

export async function GET() {
  return NextResponse.json({ enabled: isAuthEnabled() });
}

export async function POST(req: NextRequest) {
  try {
    requireAdmin(req);
  } catch (err) {
    return authErrorResponse(err)!;
  }
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
