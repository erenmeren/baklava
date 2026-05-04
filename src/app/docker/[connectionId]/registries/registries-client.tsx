"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { RelativeTime } from "@/components/workspace/relative-time";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCcw, Trash2, KeyRound } from "lucide-react";

interface Registry {
  id: string;
  name: string;
  serverAddress: string;
  username: string;
  email?: string;
  createdAt: number;
}

interface Props {
  connectionId: string;
}

const PRESETS: { label: string; serverAddress: string }[] = [
  { label: "Docker Hub", serverAddress: "https://index.docker.io/v1/" },
  { label: "GitHub Container Registry (ghcr.io)", serverAddress: "ghcr.io" },
  { label: "Quay.io", serverAddress: "quay.io" },
  {
    label: "AWS ECR",
    serverAddress: "<account>.dkr.ecr.<region>.amazonaws.com",
  },
];

export function RegistriesClient({ connectionId }: Props) {
  const [registries, setRegistries] = useState<Registry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [serverAddress, setServerAddress] = useState(
    "https://index.docker.io/v1/"
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Registry | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/docker/${connectionId}/registries`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setRegistries(data.registries as Registry[]);
    else toast.error("Could not load", { description: data.error });
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = () => {
    setName("");
    setServerAddress("https://index.docker.io/v1/");
    setUsername("");
    setPassword("");
    setEmail("");
  };

  const add = async () => {
    if (!name.trim() || !serverAddress.trim() || !username.trim() || !password) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/docker/${connectionId}/registries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          serverAddress: serverAddress.trim(),
          username: username.trim(),
          password,
          email: email.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Credential added");
        setOpen(false);
        reset();
        await load();
      } else toast.error(data.error || "Could not add");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Registry) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/registries/${encodeURIComponent(r.id)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Credential removed");
        await load();
      } else toast.error(data.error || "Could not remove");
    } finally {
      setBusy(false);
      setConfirmRemove(null);
    }
  };

  return (
    <WorkspacePage
      title="Registries"
      description={
        registries
          ? `${registries.length} credential${registries.length === 1 ? "" : "s"} in memory`
          : undefined
      }
      actions={
        <>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCcw className="size-3.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" />
            Add credential
          </Button>
        </>
      }
    >
      <Alert className="mb-6">
        <KeyRound className="size-4" />
        <AlertTitle>Per-connection, in-memory</AlertTitle>
        <AlertDescription>
          Credentials live with this Docker connection only — they vanish on
          server restart and are never persisted to disk. When you pull an
          image, Baklava matches the image reference to the right credential
          automatically (e.g. <span className="font-mono">ghcr.io/...</span>{" "}
          uses your GHCR cred).
        </AlertDescription>
      </Alert>

      {registries === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : registries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          No registry credentials yet. Add one to pull from private repos.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Server</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registries.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.serverAddress}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.username}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <RelativeTime value={r.createdAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setConfirmRemove(r)}
                      title="Remove"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : (setOpen(false), reset()))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add registry credential</DialogTitle>
            <DialogDescription>
              Used automatically when pulling images that match this server
              address.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reg-name">Display name</Label>
              <Input
                id="reg-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Docker Hub account"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-server">Server address</Label>
              <Input
                id="reg-server"
                value={serverAddress}
                onChange={(e) => setServerAddress(e.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
              />
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setServerAddress(p.serverAddress)}
                    className="text-[10px] px-2 py-0.5 rounded border border-border hover:border-brand/40 hover:text-brand transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="reg-user">Username</Label>
                <Input
                  id="reg-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-pass">Password / token</Label>
                <Input
                  id="reg-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-email">Email (optional)</Label>
              <Input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={add}
              disabled={
                busy ||
                !name.trim() ||
                !serverAddress.trim() ||
                !username.trim() ||
                !password
              }
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Add
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
            <AlertDialogTitle>Remove credential?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove{" "}
              <span className="font-mono">{confirmRemove?.name}</span> from
              memory. Future pulls from{" "}
              <span className="font-mono">{confirmRemove?.serverAddress}</span>{" "}
              will be unauthenticated.
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
