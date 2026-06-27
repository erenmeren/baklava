import { NextResponse } from "next/server";
import { isKillSwitchOn, setKillSwitch } from "@/lib/ai/kill-switch";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ on: isKillSwitchOn() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { on?: unknown };
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ error: "`on` must be a boolean" }, { status: 400 });
  }
  setKillSwitch(body.on);
  return NextResponse.json({ on: body.on });
}
