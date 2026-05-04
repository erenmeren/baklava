"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import { Loader2, Plug, Unplug } from "lucide-react";

interface NetworkAttachment {
  NetworkID?: string;
  IPAddress?: string;
  Gateway?: string;
  MacAddress?: string;
  Aliases?: string[] | null;
}

interface NetworkSummary {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

interface Props {
  connectionId: string;
  cid: string;
  networks: Record<string, NetworkAttachment> | undefined;
  onChange: () => void;
}

export function NetworksTab({ connectionId, cid, networks, onChange }: Props) {
  const [allNetworks, setAllNetworks] = useState<NetworkSummary[] | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [pickedNetwork, setPickedNetwork] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState<{
    name: string;
    id: string;
  } | null>(null);

  const loadNetworks = useCallback(async () => {
    const res = await fetch(`/api/docker/${connectionId}/networks`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setAllNetworks(data.networks as NetworkSummary[]);
  }, [connectionId]);

  useEffect(() => {
    loadNetworks();
  }, [loadNetworks]);

  const attached = networks ?? {};
  const attachedNames = new Set(Object.keys(attached));
  const available = (allNetworks ?? []).filter(
    (n) => !attachedNames.has(n.name)
  );

  const connect = async () => {
    if (!pickedNetwork) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/networks/${encodeURIComponent(pickedNetwork)}/connect`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ container: cid, action: "connect" }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(`Connected to ${pickedNetwork}`);
        setConnectOpen(false);
        setPickedNetwork("");
        onChange();
      } else {
        toast.error(data.error || "Could not connect");
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (networkName: string) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/networks/${encodeURIComponent(networkName)}/connect`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            container: cid,
            action: "disconnect",
            force: true,
          }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(`Disconnected from ${networkName}`);
        onChange();
      } else {
        toast.error(data.error || "Could not disconnect");
      }
    } finally {
      setBusy(false);
      setConfirmDisconnect(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Networks this container is attached to. Disconnect or attach more.
        </p>
        <Button
          size="sm"
          onClick={() => setConnectOpen(true)}
          disabled={available.length === 0}
        >
          <Plug className="size-3.5" />
          Connect to network
        </Button>
      </div>

      {Object.keys(attached).length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          No networks attached.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Network</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Gateway</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>Aliases</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(attached).map(([name, info]) => (
                <TableRow key={name}>
                  <TableCell className="font-mono text-xs">{name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {info.IPAddress || (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {info.Gateway || (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {info.MacAddress || (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {info.Aliases?.length ? (
                      <div className="flex gap-1 flex-wrap">
                        {info.Aliases.map((a) => (
                          <Badge
                            key={a}
                            variant="secondary"
                            className="font-mono text-[10px]"
                          >
                            {a}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setConfirmDisconnect({
                          name,
                          id: info.NetworkID || name,
                        })
                      }
                      disabled={busy}
                    >
                      <Unplug className="size-3.5" />
                      Disconnect
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect to network</DialogTitle>
          </DialogHeader>
          {allNetworks === null ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <select
              value={pickedNetwork}
              onChange={(e) => setPickedNetwork(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              <option value="">Pick a network…</option>
              {available.map((n) => (
                <option key={n.id} value={n.name}>
                  {n.name} ({n.driver})
                </option>
              ))}
            </select>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConnectOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={connect} disabled={busy || !pickedNetwork}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(confirmDisconnect)}
        onOpenChange={(o) => !o && setConfirmDisconnect(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect from network?</AlertDialogTitle>
            <AlertDialogDescription>
              This will detach the container from{" "}
              <span className="font-mono">{confirmDisconnect?.name}</span>.
              Network connections may break until you re-attach.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmDisconnect && disconnect(confirmDisconnect.name)
              }
              disabled={busy}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
