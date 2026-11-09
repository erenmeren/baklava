import { requireUser, authErrorResponse } from "@/lib/auth/current-user";
import { getUserById, listUsers, publicUser } from "@/lib/auth/users";
import { getConnection } from "@/lib/connections/store";
import { getGrants, isHostLocal, setGrants, type AccessLevel } from "@/lib/connections/access";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Owner-or-admin gate. Returns the loaded connection, or a Response to return
 *  directly (401 / 404 / 403). */
function authorize(req: Request, conn: ReturnType<typeof getConnection>) {
  const user = requireUser(req); // throws AuthError(401) if unauthenticated
  if (!conn) {
    return { error: Response.json({ error: "Connection not found" }, { status: 404 }) };
  }
  const allowed = user.role === "admin" || conn.ownerId === user.id;
  if (!allowed) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const conn = getConnection(id);
    const gate = authorize(req, conn);
    if (gate.error) return gate.error;

    const grantMap = getGrants(id);
    const grants = Object.entries(grantMap)
      .map(([userId, level]) => {
        const u = getUserById(userId);
        if (!u) return null; // skip grants pointing at deleted users
        return { userId, username: u.username, level };
      })
      .filter((g): g is { userId: string; username: string; level: AccessLevel } => g !== null);

    const owner = conn!.ownerId ? getUserById(conn!.ownerId) : null;

    return Response.json({
      ownerId: conn!.ownerId ?? null,
      ownerUsername: owner?.username ?? null,
      grants,
      // Owners only need someone to grant to; roles and disabled flags stay
      // admin-only so a member can't enumerate the user directory.
      users:
        gate.user.role === "admin"
          ? listUsers().map(publicUser)
          : listUsers()
              .filter((u) => !u.disabled)
              .map((u) => ({ id: u.id, username: u.username })),
    });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const conn = getConnection(id);
    const gate = authorize(req, conn);
    if (gate.error) return gate.error;

    const body = (await req.json().catch(() => null)) as { grants?: unknown } | null;
    const rawGrants = body?.grants;
    if (!rawGrants || typeof rawGrants !== "object" || Array.isArray(rawGrants)) {
      return Response.json({ error: "Expected { grants: { [userId]: 'read'|'write' } }" }, { status: 400 });
    }

    const clean: Record<string, AccessLevel> = {};
    for (const [userId, level] of Object.entries(rawGrants as Record<string, unknown>)) {
      if (level !== "read" && level !== "write") {
        return Response.json({ error: `Invalid access level for ${userId}` }, { status: 400 });
      }
      if (!getUserById(userId)) {
        return Response.json({ error: `Unknown user ${userId}` }, { status: 400 });
      }
      clean[userId] = level;
    }
    if (Object.values(clean).includes("write") && isHostLocal(id)) {
      return Response.json(
        {
          error:
            "This connection runs with the Baklava host's privileges (Docker socket or host kubeconfig) — only admins can write to it. Grant read instead.",
        },
        { status: 400 },
      );
    }

    setGrants(id, clean);
    return Response.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
