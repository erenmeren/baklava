"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { RefreshButton } from "@/components/workspace/auto-refresh";

interface NetworkSummary {
  id: string;
  shortId: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
}

interface Props {
  connectionId: string;
}

const BUILTIN = new Set(["bridge", "host", "none"]);

export function NetworksClient({ connectionId }: Props) {
  const [networks, setNetworks] = useState<NetworkSummary[] | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<NetworkSummary | null>(
    null
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDriver, setCreateDriver] = useState("bridge");
  const [createSubnet, setCreateSubnet] = useState("");
  const [createInternal, setCreateInternal] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/docker/${connectionId}/networks`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setNetworks(data.networks as NetworkSummary[]);
    else toast.error("Could not load", { description: data.error });
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/docker/${connectionId}/networks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          driver: createDriver,
          subnet: createSubnet.trim() || undefined,
          internal: createInternal,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Network created");
        setCreateOpen(false);
        setCreateName("");
        setCreateSubnet("");
        setCreateDriver("bridge");
        setCreateInternal(false);
        await load();
      } else {
        toast.error(data.error || "Create failed");
      }
    } finally {
      setCreating(false);
    }
  };

  const remove = async (n: NetworkSummary) => {
    setBusy(n.id);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/networks/${encodeURIComponent(n.id)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Network removed");
        await load();
      } else toast.error(data.error || "Could not remove");
    } finally {
      setBusy(null);
      setConfirmRemove(null);
    }
  };

  return (
    <WorkspacePage
      title="Networks"
      description={
        networks
          ? `${networks.length} network${networks.length === 1 ? "" : "s"}`
          : undefined
      }
      actions={
        <>
          <RefreshButton onClick={load} />
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            Create
          </Button>
        </>
      }
    >
      {networks === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : networks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          No networks.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {networks.map((n) => {
                const isBuiltin = BUILTIN.has(n.name);
                return (
                  <TableRow key={n.id}>
                    <TableCell className="font-mono text-xs">
                      {n.name}
                      {isBuiltin ? (
                        <Badge
                          variant="secondary"
                          className="ml-2 text-[10px]"
                        >
                          built-in
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {n.shortId}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {n.driver}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {n.scope}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setConfirmRemove(n)}
                        disabled={isBuiltin || busy === n.id}
                        title={isBuiltin ? "Built-in" : "Remove"}
                      >
                        {busy === n.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create network</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="net-name">Name</Label>
              <Input
                id="net-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="my-network"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="net-driver">Driver</Label>
                <select
                  id="net-driver"
                  value={createDriver}
                  onChange={(e) => setCreateDriver(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                >
                  <option value="bridge">bridge</option>
                  <option value="overlay">overlay</option>
                  <option value="macvlan">macvlan</option>
                  <option value="ipvlan">ipvlan</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="net-subnet">Subnet (optional)</Label>
                <Input
                  id="net-subnet"
                  value={createSubnet}
                  onChange={(e) => setCreateSubnet(e.target.value)}
                  placeholder="172.28.0.0/16"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <Label htmlFor="net-internal" className="cursor-pointer">
                Internal (no external connectivity)
              </Label>
              <Switch
                id="net-internal"
                checked={createInternal}
                onCheckedChange={setCreateInternal}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={create} disabled={creating || !createName.trim()}>
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(confirmRemove)}
        onOpenChange={(o) => !o && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove network?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove network{" "}
              <span className="font-mono">{confirmRemove?.name}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRemove && remove(confirmRemove)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}
