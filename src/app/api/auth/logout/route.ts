import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  isHttps,
  revokeSessionToken,
} from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  revokeSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(isHttps(req)),
    maxAge: 0,
  });
  return res;
}
