"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Pencil,
  Plus,
  Shield,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RoleFormDialog, type RoleFormSeed } from "../role-form-dialog";
import { RefreshButton } from "@/components/workspace/auto-refresh";

interface RoleInfo {
  name: string;
  isSuperuser: boolean;
  canLogin: boolean;
  canCreateDb: boolean;
  canCreateRole: boolean;
  canReplication: boolean;
  inherits: boolean;
  connectionLimit: number;
  validUntil: string | null;
  memberOf: string[];
}

interface Props {
  connectionId: string;
}

const ATTR_FLAGS: Array<{
  key: keyof Pick<
    RoleInfo,
    | "canLogin"
    | "isSuperuser"
    | "canCreateDb"
    | "canCreateRole"
    | "canReplication"
    | "inherits"
  >;
  label: string;
  className: string;
}> = [
  { key: "canLogin", label: "login", className: "bg-brand/15 text-brand border-brand/40" },
  {
    key: "isSuperuser",
    label: "super",
    className:
      "bg-destructive/10 text-destructive border-destructive/40",
  },
  { key: "canCreateDb", label: "createdb", className: "bg-foreground/5 text-foreground/80 border-border" },
  { key: "canCreateRole", label: "createrole", className: "bg-foreground/5 text-foreground/80 border-border" },
  { key: "canReplication", label: "replication", className: "bg-foreground/5 text-foreground/80 border-border" },
  { key: "inherits", label: "inherit", className: "bg-foreground/5 text-foreground/80 border-border" },
];

export function RolesClient({ connectionId }: Props) {
  const [roles, setRoles] = useState<RoleInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RoleFormSeed | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/postgres/${connectionId}/roles`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Could not load roles", { description: data.error });
        return;
      }
      setRoles(data.roles as RoleInfo[]);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const performDrop = async () => {
    if (!dropTarget) return;
    setDropping(true);
    try {
      const res = await fetch(
        `/api/postgres/${connectionId}/roles/${encodeURIComponent(dropTarget)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error("Could not drop role", { description: data.error });
        return;
      }
      toast.success(`Role “${dropTarget}” dropped`);
      setDropTarget(null);
      load();
    } finally {
      setDropping(false);
    }
  };

  return (
    <WorkspacePage
      title={
        <span className="inline-flex items-center gap-2">
          <Shield className="size-4 text-muted-foreground" /> Roles
        </span>
      }
      description={
        <span className="text-xs">
          Server-wide roles ·{" "}
          <span className="font-mono">pg_roles</span>
        </span>
      }
      actions={
        <>
          <RefreshButton onClick={load} loading={loading} />
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            New role
          </Button>
        </>
      }
    >
      {roles === null ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No roles.</p>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead className="bg-muted/60 sticky top-0 z-[1]">
              <tr>
                <th className="text-left px-3 py-2 font-semibold border-b border-border/60 whitespace-nowrap">
                  Name
                </th>
                <th className="text-left px-3 py-2 font-semibold border-b border-border/60 whitespace-nowrap">
                  Attributes
                </th>
                <th className="text-left px-3 py-2 font-semibold border-b border-border/60 whitespace-nowrap">
                  Conn limit
                </th>
                <th className="text-left px-3 py-2 font-semibold border-b border-border/60 whitespace-nowrap">
                  Member of
                </th>
                <th className="border-b border-border/60 w-px" />
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr
                  key={r.name}
                  className="group border-b border-border/30 hover:bg-foreground/[0.025]"
                >
                  <td className="px-3 py-2 align-middle whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {r.isSuperuser ? (
                        <ShieldCheck className="size-3 text-destructive" />
                      ) : (
                        <Shield className="size-3 text-muted-foreground/70" />
                      )}
                      <span className="text-foreground">{r.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="flex flex-wrap items-center gap-1">
                      {ATTR_FLAGS.filter((f) => r[f.key]).map((f) => (
                        <span
                          key={f.key}
                          className={cn(
                            "inline-flex items-center px-1.5 py-px rounded border text-[10px] uppercase tracking-wider",
                            f.className,
                          )}
                        >
                          {f.label}
                        </span>
                      ))}
                      {ATTR_FLAGS.every((f) => !r[f.key]) ? (
                        <span className="text-muted-foreground/60 italic text-[11px]">
                          —
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle text-muted-foreground">
                    {r.connectionLimit === -1 ? "∞" : r.connectionLimit}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    {r.memberOf.length === 0 ? (
                      <span className="text-muted-foreground/60 italic text-[11px]">
                        —
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {r.memberOf.map((m) => (
                          <span
                            key={m}
                            className="inline-flex items-center px-1.5 py-px rounded border border-border bg-muted/60 text-[10px]"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1 align-middle whitespace-nowrap">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title="Edit role"
                        onClick={() =>
                          setEditTarget({
                            name: r.name,
                            canLogin: r.canLogin,
                            isSuperuser: r.isSuperuser,
                            canCreateDb: r.canCreateDb,
                            canCreateRole: r.canCreateRole,
                            canReplication: r.canReplication,
                            inherits: r.inherits,
                            connectionLimit: r.connectionLimit,
                          })
                        }
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive hover:text-destructive"
                        title="Drop role"
                        onClick={() => setDropTarget(r.name)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RoleFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        connectionId={connectionId}
        onSuccess={load}
      />

      {editTarget ? (
        <RoleFormDialog
          mode="edit"
          open={true}
          onOpenChange={(v) => {
            if (!v) setEditTarget(null);
          }}
          connectionId={connectionId}
          initial={editTarget}
          onSuccess={load}
        />
      ) : null}

      <AlertDialog
        open={dropTarget !== null}
        onOpenChange={(v) => {
          if (!v && !dropping) setDropTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop role?</AlertDialogTitle>
            <AlertDialogDescription>
              This will run{" "}
              <span className="font-mono">DROP ROLE &quot;{dropTarget}&quot;</span>.
              The role must not own any database objects.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dropping}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                performDrop();
              }}
              disabled={dropping}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {dropping ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Drop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}
