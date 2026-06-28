"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  CheckCircle2,
  AlertCircle,
  Trash2,
  Circle,
  ArrowRight,
  Pencil,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import type { ConnectionRecord, TechId } from "@/lib/connections/types";
import { AccessDialog } from "@/components/connections/access-dialog";

interface Props {
  tech: TechId;
  refreshKey: number;
  renderSummary?: (record: ConnectionRecord) => React.ReactNode;
  emptyState?: React.ReactNode;
  onEdit?: (record: ConnectionRecord) => void;
}

export function ConnectionsList({
  tech,
  refreshKey,
  renderSummary,
  emptyState,
  onEdit,
}: Props) {
  const router = useRouter();
  const [records, setRecords] = useState<ConnectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ConnectionRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [me, setMe] = useState<{ id: string; role: "admin" | "member" } | null>(
    null
  );
  const [accessFor, setAccessFor] = useState<ConnectionRecord | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/connections?tech=${tech}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { connections: ConnectionRecord[] };
      setRecords(data.connections);
    } finally {
      setLoading(false);
    }
  }, [tech]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/users/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          user: { id: string; role: "admin" | "member" };
        };
        if (data.user) setMe({ id: data.user.id, role: data.user.role });
      } catch {
        /* non-fatal — access controls just won't show */
      }
    })();
  }, []);

  const remove = async () => {
    if (!confirm) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/connections/${confirm.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Connection removed");
        setConfirm(null);
        load();
      } else {
        toast.error("Could not remove connection");
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Loading connections…
      </Card>
    );
  }

  if (records.length === 0) {
    return (
      <Card className="p-6 border-dashed text-sm text-muted-foreground">
        {emptyState ??
          "No saved connections yet. Test one on the left to add it."}
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-3">
        {records.map((r) => (
          <Card
            key={r.id}
            className="p-4 flex flex-row items-center justify-between gap-4 hover:border-brand/40 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              {r.status === "ok" ? (
                <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
              ) : r.status === "error" ? (
                <AlertCircle className="size-5 text-red-500 shrink-0" />
              ) : (
                <Circle className="size-5 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0">
                <div className="font-medium truncate">{r.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {renderSummary ? renderSummary(r) : r.id}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                onClick={() => router.push(`/${tech}/${r.id}`)}
                disabled={r.status === "error"}
              >
                Open
                <ArrowRight className="size-3.5" />
              </Button>
              {me && (me.role === "admin" || r.ownerId === me.id) ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setAccessFor(r)}
                  title="Manage access"
                >
                  <UsersRound className="size-4" />
                </Button>
              ) : null}
              {onEdit ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onEdit(r)}
                  title="Edit connection"
                >
                  <Pencil className="size-4" />
                </Button>
              ) : null}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setConfirm(r)}
                title="Remove"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <AlertDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o && !deleting) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this connection?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">
                {confirm?.name}
              </span>{" "}
              will be removed from this session. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={remove}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {accessFor ? (
        <AccessDialog
          connectionId={accessFor.id}
          connectionName={accessFor.name}
          open={!!accessFor}
          onOpenChange={(o) => {
            if (!o) setAccessFor(null);
          }}
        />
      ) : null}
    </>
  );
}
