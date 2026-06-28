import { requireAdmin, authErrorResponse } from "@/lib/auth/current-user";
import { updateUser, deleteUser, publicUser, type Role } from "@/lib/auth/users";
import { revokeUserSessions } from "@/lib/auth/sessions";
import { listConnections, reassignOwner } from "@/lib/connections/store";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as {
      role?: unknown;
      disabled?: unknown;
      password?: unknown;
    } | null;

    const patch: { role?: Role; disabled?: boolean; password?: string } = {};
    if (body?.role === "admin" || body?.role === "member") patch.role = body.role;
    if (typeof body?.disabled === "boolean") patch.disabled = body.disabled;
    if (typeof body?.password === "string" && body.password) patch.password = body.password;

    let user;
    try {
      user = updateUser(id, patch);
    } catch (e) {
      // Last-admin guard (and "user not found") throw — surface as 409 conflict.
      const msg = e instanceof Error ? e.message : "Could not update user.";
      return Response.json({ error: msg }, { status: 409 });
    }

    // A role/disabled/password change must force the target to re-authenticate.
    if (patch.role !== undefined || patch.disabled !== undefined || patch.password !== undefined) {
      revokeUserSessions(id);
    }

    return Response.json({ user: publicUser(user) });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const acting = requireAdmin(req);
    const { id } = await params;

    if (id === acting.id) {
      return Response.json({ error: "You cannot delete your own account." }, { status: 400 });
    }

    // Delete first so a guard failure (e.g. last-admin) leaves ownership
    // untouched. The id still identifies the orphaned connections afterward.
    try {
      deleteUser(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not delete user.";
      return Response.json({ error: msg }, { status: 409 });
    }

    // Reassign the now-deleted user's owned connections to the acting admin so
    // they don't become orphaned (legacy ownerId-less rows are admin-only).
    for (const conn of listConnections()) {
      if (conn.ownerId === id) reassignOwner(conn.id, acting.id);
    }

    revokeUserSessions(id);
    return Response.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
