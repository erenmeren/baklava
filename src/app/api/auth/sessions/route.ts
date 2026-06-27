import { NextRequest, NextResponse } from "next/server";
import { listSessions } from "@/lib/auth/sessions";
import { SESSION_COOKIE, sessionIdFromToken } from "@/lib/auth/session";

export const runtime = "nodejs";

function getCookieValue(req: Request, name: string): string | undefined {
  // NextRequest exposes .cookies; plain Request does not (e.g. in unit tests).
  const next = req as NextRequest;
  if (typeof next.cookies?.get === "function") {
    return next.cookies.get(name)?.value;
  }
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k.trim() === name) return rest.join("=");
  }
  return undefined;
}

export async function GET(req: Request) {
  const currentId = sessionIdFromToken(getCookieValue(req, SESSION_COOKIE));
  const sessions = listSessions().map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    userAgent: s.userAgent,
    current: s.id === currentId,
  }));
  return NextResponse.json({ sessions });
}
