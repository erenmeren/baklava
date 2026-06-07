import "server-only";
import { NextResponse } from "next/server";
import { formatError } from "@/lib/errors";
import {
  publicSettings,
  saveProvider,
  setActiveProvider,
  setStepCap,
  setAgentName,
  type ProviderId,
} from "@/lib/ai/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ settings: publicSettings() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      provider?: ProviderId;
      apiKey?: string;
      model?: string;
      activeProvider?: ProviderId | null;
      stepCap?: number;
      agentName?: string;
    };
    if (body.provider) {
      saveProvider(body.provider, { apiKey: body.apiKey ?? "", model: body.model ?? "" });
    }
    if (body.activeProvider !== undefined) setActiveProvider(body.activeProvider);
    if (typeof body.stepCap === "number") setStepCap(body.stepCap);
    if (typeof body.agentName === "string") setAgentName(body.agentName);
    return NextResponse.json({ settings: publicSettings() });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
