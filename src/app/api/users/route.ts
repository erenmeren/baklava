import { requireAdmin, authErrorResponse } from "@/lib/auth/current-user";
import { listUsers, createUser, publicUser, type Role } from "@/lib/auth/users";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    requireAdmin(req);
    return Response.json({ users: listUsers().map(publicUser) });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    requireAdmin(req);
    const body = (await req.json().catch(() => null)) as {
      username?: unknown;
      password?: unknown;
      role?: unknown;
    } | null;
    const username = typeof body?.username === "string" ? body.username : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const role: Role = body?.role === "admin" ? "admin" : "member";

    if (!password) {
      return Response.json({ error: "Password is required." }, { status: 400 });
    }

    try {
      const user = createUser({ username, password, role });
      return Response.json({ user: publicUser(user) });
    } catch (e) {
      // createUser throws on invalid/duplicate username — surface its message
      // (no internals) as a 409 conflict.
      const msg = e instanceof Error ? e.message : "Could not create user.";
      return Response.json({ error: msg }, { status: 409 });
    }
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
