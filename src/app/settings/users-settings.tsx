"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { UsersRound } from "lucide-react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Role = "admin" | "member";

interface PublicUser {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  createdAt: number;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

export function UsersSettings() {
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add-user form state.
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("member");
  const [adding, setAdding] = useState(false);

  // Inline reset-password state, keyed by user id.
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const refresh = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (!res.ok) {
        setLoadError(true);
        setUsers([]);
        return;
      }
      const data = (await res.json()) as { users: PublicUser[] };
      setUsers(data.users ?? []);
    } catch {
      setLoadError(true);
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/users/me", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { user: PublicUser };
          setCurrentId(data.user?.id ?? null);
        }
      } catch {
        /* non-fatal — self-protection just won't apply */
      }
    })();
    void refresh();
  }, [refresh]);

  async function patchUser(id: string, patch: Record<string, unknown>, ok: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        toast.success(ok);
        await refresh();
      } else {
        toast.error(await readError(res, "Could not update user."));
      }
    } catch {
      toast.error("Could not update user.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(u: PublicUser) {
    if (!window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    setBusyId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("User deleted");
        await refresh();
      } else {
        toast.error(await readError(res, "Could not delete user."));
      }
    } catch {
      toast.error("Could not delete user.");
    } finally {
      setBusyId(null);
    }
  }

  async function submitReset(id: string) {
    if (!resetPassword) {
      toast.error("Enter a new password.");
      return;
    }
    await patchUser(id, { password: resetPassword }, "Password reset");
    setResetFor(null);
    setResetPassword("");
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword) {
      toast.error("Username and password are required.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      if (res.ok) {
        toast.success("User created");
        setNewUsername("");
        setNewPassword("");
        setNewRole("member");
        await refresh();
      } else {
        toast.error(await readError(res, "Could not create user."));
      }
    } catch {
      toast.error("Could not create user.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersRound className="size-4" />
          Users
        </CardTitle>
        <CardDescription>
          People who can sign in to this console and what they can do.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {users === null ? (
          <Skeleton className="h-24 w-full" />
        ) : loadError ? (
          <p className="text-sm text-destructive">
            Could not load users. You may not have permission, or the server is
            unavailable.
          </p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users yet.</p>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => {
              const isSelf = u.id === currentId;
              const busy = busyId === u.id;
              const selfTitle = isSelf
                ? "You can't change your own role or access here."
                : undefined;
              return (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{u.username}</p>
                      <Badge variant={u.role === "admin" ? "secondary" : "outline"} className="shrink-0">
                        {u.role}
                      </Badge>
                      {u.disabled ? (
                        <Badge variant="destructive" className="shrink-0">disabled</Badge>
                      ) : null}
                      {isSelf ? (
                        <span className="text-xs text-muted-foreground shrink-0">you</span>
                      ) : null}
                    </div>
                    {resetFor === u.id ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          type="password"
                          autoFocus
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                          placeholder="New password"
                          className="h-7 w-48"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void submitReset(u.id);
                            if (e.key === "Escape") { setResetFor(null); setResetPassword(""); }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void submitReset(u.id)}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setResetFor(null); setResetPassword(""); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Select
                      value={u.role}
                      disabled={isSelf || busy}
                      onValueChange={(v) =>
                        void patchUser(u.id, { role: v as Role }, "Role updated")
                      }
                    >
                      <SelectTrigger size="sm" className="w-28" title={selfTitle}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="member">member</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSelf || busy}
                      title={selfTitle}
                      onClick={() =>
                        void patchUser(
                          u.id,
                          { disabled: !u.disabled },
                          u.disabled ? "User enabled" : "User disabled",
                        )
                      }
                    >
                      {u.disabled ? "Enable" : "Disable"}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setResetFor(resetFor === u.id ? null : u.id);
                        setResetPassword("");
                      }}
                    >
                      Reset password
                    </Button>

                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isSelf || busy}
                      title={selfTitle}
                      onClick={() => void removeUser(u)}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={addUser} className="space-y-3 border-t border-border/60 pt-5">
          <p className="text-sm font-medium">Add user</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="new-username">Username</label>
              <Input
                id="new-username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="username"
                className="w-44"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="new-password">Password</label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="password"
                className="w-44"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Role</label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">admin</SelectItem>
                  <SelectItem value="member">member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="sm" disabled={adding}>
              {adding ? "Adding…" : "Add user"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
