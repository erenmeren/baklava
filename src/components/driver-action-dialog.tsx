"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type DriverAction = "install" | "uninstall";

interface Props {
  action: DriverAction;
  techId: string | null;
  techName: string;
  /** The driver packages this tech needs — shown in the dialog, not on the card. */
  packages: string[];
  /** Whether the server-side operation is allowed (local request + not disabled). */
  canInstall: boolean;
  /** Saved connections of this tech — used to warn before uninstalling. */
  connectionCount?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const COPY = {
  install: {
    title: (n: string) => `Install ${n} driver`,
    blurb: (n: string, multi: boolean) =>
      `${n} needs ${multi ? "these packages" : "this package"} to connect.`,
    busy: (n: string) => `Installing the ${n} driver…`,
    confirm: "Install",
    confirmVariant: "default" as const,
    npm: "npm i",
    toast: (n: string) => `${n} driver installed`,
  },
  uninstall: {
    title: (n: string) => `Uninstall ${n} driver`,
    blurb: (n: string, multi: boolean) =>
      `Remove the ${n} driver ${multi ? "packages" : "package"} from node_modules.`,
    busy: (n: string) => `Uninstalling the ${n} driver…`,
    confirm: "Uninstall",
    confirmVariant: "destructive" as const,
    npm: "npm uninstall",
    toast: (n: string) => `${n} driver uninstalled`,
  },
};

export function DriverActionDialog({
  action,
  techId,
  techName,
  packages,
  canInstall,
  connectionCount = 0,
  open,
  onOpenChange,
}: Props) {
  const [phase, setPhase] = useState<"idle" | "running" | "error">("idle");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState("");
  const sourceRef = useRef<EventSource | null>(null);
  const router = useRouter();
  const copy = COPY[action];

  // Reset to the confirm screen each time the dialog opens for a tech/action.
  useEffect(() => {
    if (open) {
      setPhase("idle");
      setLog([]);
      setError("");
    }
  }, [open, techId, action]);

  // Closing aborts an in-flight op (server kills npm via the request abort signal).
  useEffect(() => {
    if (!open && sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, [open]);

  // Belt-and-suspenders unmount cleanup (per the SSE-client convention).
  useEffect(() => () => sourceRef.current?.close(), []);

  const start = () => {
    if (!techId) return;
    setPhase("running");
    setLog([]);
    setError("");

    const es = new EventSource(`/api/techs/${techId}/${action}`);
    sourceRef.current = es;

    es.addEventListener("start", (e) => {
      const { packages: pkgs } = JSON.parse((e as MessageEvent).data) as { packages: string[] };
      setLog((l) => [...l, `$ npm ${action} ${pkgs.join(" ")} --no-save`]);
    });
    es.addEventListener("progress", (e) => {
      const { line } = JSON.parse((e as MessageEvent).data) as { line: string };
      setLog((l) => [...l, line]);
    });
    es.addEventListener("done", () => {
      es.close();
      sourceRef.current = null;
      toast.success(copy.toast(techName));
      router.refresh();
      onOpenChange(false);
    });
    es.addEventListener("error", (e) => {
      let message = `${action === "install" ? "Install" : "Uninstall"} failed (connection lost)`;
      const data = (e as MessageEvent).data;
      if (data) {
        try { message = (JSON.parse(data) as { message: string }).message ?? message; } catch { /* native error event */ }
      }
      es.close();
      sourceRef.current = null;
      setError(message);
      setPhase("error");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title(techName)}</DialogTitle>
          <DialogDescription>
            {phase === "running" ? copy.busy(techName) : copy.blurb(techName, packages.length !== 1)}
          </DialogDescription>
        </DialogHeader>

        {phase === "idle" && (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                Packages
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {packages.map((p) => (
                  <li
                    key={p}
                    className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            {action === "uninstall" && connectionCount > 0 && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {`${connectionCount} saved ${connectionCount === 1 ? "connection" : "connections"} will stop working until you reinstall the driver. They won't be deleted.`}
              </p>
            )}

            {canInstall ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button variant={copy.confirmVariant} onClick={start}>
                  {copy.confirm}
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm text-muted-foreground">
                  Run this in your terminal, then refresh:
                </p>
                <code className="block select-all rounded-md bg-muted p-2 font-mono text-xs">
                  {copy.npm} {packages.join(" ")}
                </code>
              </div>
            )}
          </div>
        )}

        {phase === "running" && (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
            {log.join("\n") || "Starting…"}
          </pre>
        )}

        {phase === "error" && (
          <div className="space-y-3">
            {log.length > 0 && (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
                {log.join("\n")}
              </pre>
            )}
            <p className="text-sm text-destructive">{error}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button variant={copy.confirmVariant} onClick={start}>
                Try again
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
