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

interface Props {
  techId: string | null;
  techName: string;
  /** The driver packages this tech needs — shown in the dialog, not on the card. */
  packages: string[];
  /** Whether server-side install is allowed (local request + not disabled). */
  canInstall: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InstallDriverDialog({
  techId,
  techName,
  packages,
  canInstall,
  open,
  onOpenChange,
}: Props) {
  const [phase, setPhase] = useState<"idle" | "installing" | "error">("idle");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState("");
  const sourceRef = useRef<EventSource | null>(null);
  const router = useRouter();

  // Reset to the confirm screen each time the dialog opens for a tech.
  useEffect(() => {
    if (open) {
      setPhase("idle");
      setLog([]);
      setError("");
    }
  }, [open, techId]);

  // Closing the dialog aborts an in-flight install (server kills npm via the
  // request abort signal) so we never leave an orphaned stream/process.
  useEffect(() => {
    if (!open && sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, [open]);

  // Belt-and-suspenders unmount cleanup (per the SSE-client convention).
  useEffect(() => () => sourceRef.current?.close(), []);

  const startInstall = () => {
    if (!techId) return;
    setPhase("installing");
    setLog([]);
    setError("");

    const es = new EventSource(`/api/techs/${techId}/install`);
    sourceRef.current = es;

    es.addEventListener("start", (e) => {
      const { packages: pkgs } = JSON.parse((e as MessageEvent).data) as { packages: string[] };
      setLog((l) => [...l, `$ npm install ${pkgs.join(" ")}`]);
    });
    es.addEventListener("progress", (e) => {
      const { line } = JSON.parse((e as MessageEvent).data) as { line: string };
      setLog((l) => [...l, line]);
    });
    es.addEventListener("done", () => {
      es.close();
      sourceRef.current = null;
      toast.success(`${techName} driver installed`);
      router.refresh();
      onOpenChange(false);
    });
    es.addEventListener("error", (e) => {
      let message = "Install failed (connection lost)";
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
          <DialogTitle>Install {techName} driver</DialogTitle>
          <DialogDescription>
            {phase === "installing"
              ? `Installing the ${techName} driver…`
              : `${techName} needs ${packages.length === 1 ? "this package" : "these packages"} to connect.`}
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

            {canInstall ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={startInstall}>Install</Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm text-muted-foreground">
                  Install from your terminal, then refresh:
                </p>
                <code className="block select-all rounded-md bg-muted p-2 font-mono text-xs">
                  npm i {packages.join(" ")}
                </code>
              </div>
            )}
          </div>
        )}

        {phase === "installing" && (
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
              <Button onClick={startInstall}>Try again</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
