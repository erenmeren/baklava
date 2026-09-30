import { NextResponse } from "next/server";
import { isKillSwitchOn, setKillSwitch } from "@/lib/ai/kill-switch";
import { authErrorResponse, requireAdmin } from "@/lib/auth/current-user";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ on: isKillSwitchOn() });
}

export async function POST(req: Request) {
  // An admin's emergency stop must not be undoable by a member.
  try {
    requireAdmin(req);
  } catch (err) {
    return authErrorResponse(err)!;
  }
  const body = (await req.json().catch(() => ({}))) as { on?: unknown };
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ error: "`on` must be a boolean" }, { status: 400 });
  }
  setKillSwitch(body.on);
  return NextResponse.json({ on: body.on });
}
