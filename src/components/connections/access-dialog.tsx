"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AccessLevel = "read" | "write";
type Choice = "none" | AccessLevel;

interface PublicUser {
  id: string;
  username: string;
  role: "admin" | "member";
  disabled: boolean;
  createdAt: number;
}

interface AccessResponse {
  ownerId: string | null;
  ownerUsername: string | null;
  grants: { userId: string; username: string; level: AccessLevel }[];
  users: PublicUser[];
}

interface Props {
  connectionId: string;
  connectionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccessDialog({
  connectionId,
  connectionName,
  open,
  onOpenChange,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AccessResponse | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/connections/${connectionId}/access`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? "You don't have permission to manage access for this connection."
            : "Could not load access settings."
        );
        setData(null);
        return;
      }
      const json = (await res.json()) as AccessResponse;
      setData(json);
      const grantMap = new Map(json.grants.map((g) => [g.userId, g.level]));
      const next: Record<string, Choice> = {};
      for (const u of json.users) {
        if (u.id === json.ownerId) continue;
        next[u.id] = grantMap.get(u.id) ?? "none";
      }
      setChoices(next);
    } catch {
      setError("Could not load access settings.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const save = async () => {
    setSaving(true);
    try {
      const grants: Record<string, AccessLevel> = {};
      for (const [userId, choice] of Object.entries(choices)) {
        if (choice !== "none") grants[userId] = choice;
      }
      const res = await fetch(`/api/connections/${connectionId}/access`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grants }),
      });
      if (res.ok) {
        toast.success("Access updated");
        onOpenChange(false);
      } else {
        let message = "Could not update access.";
        try {
          const json = (await res.json()) as { error?: string };
          if (json?.error) message = json.error;
        } catch {
          /* ignore */
        }
        toast.error(message);
      }
    } catch {
      toast.error("Could not update access.");
    } finally {
      setSaving(false);
    }
  };

  const others = data
    ? data.users.filter((u) => u.id !== data.ownerId)
    : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!saving) onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage access</DialogTitle>
          <DialogDescription>
            Choose who can use{" "}
            <span className="font-medium text-foreground">{connectionName}</span>{" "}
            and at what level.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : data ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-medium truncate">
                  {data.ownerUsername ?? "Unknown"}
                </p>
                <Badge variant="secondary" className="shrink-0">
                  owner
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                full access
              </span>
            </div>

            {others.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No other users to grant access to.
              </p>
            ) : (
              <ul className="space-y-2">
                {others.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {u.username}
                      </p>
                      {u.role === "admin" ? (
                        <Badge variant="outline" className="shrink-0">
                          admin
                        </Badge>
                      ) : null}
                      {u.disabled ? (
                        <Badge variant="destructive" className="shrink-0">
                          disabled
                        </Badge>
                      ) : null}
                    </div>
                    <Select
                      value={choices[u.id] ?? "none"}
                      onValueChange={(v) =>
                        setChoices((prev) => ({
                          ...prev,
                          [u.id]: v as Choice,
                        }))
                      }
                    >
                      <SelectTrigger size="sm" className="w-28 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">none</SelectItem>
                        <SelectItem value="read">read</SelectItem>
                        <SelectItem value="write">write</SelectItem>
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || loading || !!error}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
