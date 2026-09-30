import { NextRequest, NextResponse } from "next/server";
import {
  getUserByUsername,
  listUsers,
  verifyUserPassword,
  type UserRecord,
} from "@/lib/auth/users";
import {
  clearLoginFailures,
  isLoginThrottled,
  recordLoginFailure,
} from "@/lib/auth/login-throttle";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  isHttps,
} from "@/lib/auth/session";

// A throwaway record used only to spend roughly the same scrypt time when no
// user is resolved, so the response timing doesn't reveal whether a username
// exists. The salt/hash are fixed garbage; verifyUserPassword will fail.
const DUMMY_USER: UserRecord = {
  id: "",
  username: "",
  // 64-byte (128 hex) blob so the buffer-length compare path runs like a real one
  passwordHash: "00".repeat(64),
  salt: "00".repeat(16),
  role: "member",
  disabled: false,
  createdAt: 0,
  updatedAt: 0,
};

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    username?: unknown;
    password?: unknown;
  };
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Resolve the target user: by username if given, else the sole enabled user
  // (the common single-user case). Anything else → no user resolved.
  let user: UserRecord | null = null;
  if (username) {
    user = getUserByUsername(username);
  } else {
    const enabled = listUsers().filter((u) => !u.disabled);
    if (enabled.length === 1) user = enabled[0];
  }

  // Throttle per account (see login-throttle.ts). The sole-user password-only
  // form shares the account's bucket, and unknown usernames get their own, so
  // the answer is the same whether or not the account exists.
  const account = user?.username ?? username;
  if (isLoginThrottled(account, req.headers)) {
    return NextResponse.json(
      { error: "Too many attempts — wait a few minutes and try again." },
      { status: 429 },
    );
  }

  // Anti-enumeration: when no user is resolved, still run a scrypt verify
  // against a dummy record so the timing matches the user-exists path. We never
  // reveal whether the username exists or the password was simply wrong — the
  // 401 body is identical in every failure case.
  const passwordOk = verifyUserPassword(user ?? DUMMY_USER, password);
  const ok = !!user && !user.disabled && passwordOk;

  if (!ok || !user) {
    recordLoginFailure(account, req.headers);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  clearLoginFailures(account);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(user.id, req.headers.get("user-agent") ?? ""),
    sessionCookieOptions(isHttps(req)),
  );
  return res;
}
