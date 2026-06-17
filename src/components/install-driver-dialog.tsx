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

interface Props {
  techId: string | null;
  techName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InstallDriverDialog({ techId, techName, open, onOpenChange }: Props) {
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<"running" | "error">("running");
  const [error, setError] = useState("");
  const sourceRef = useRef<EventSource | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open || !techId) return;
    setLog([]);
    setStatus("running");
    setError("");

    const es = new EventSource(`/api/techs/${techId}/install`);
    sourceRef.current = es;

    es.addEventListener("start", (e) => {
      const { packages } = JSON.parse((e as MessageEvent).data) as { packages: string[] };
      setLog((l) => [...l, `$ npm install ${packages.join(" ")}`]);
    });
    es.addEventListener("progress", (e) => {
      const { line } = JSON.parse((e as MessageEvent).data) as { line: string };
      setLog((l) => [...l, line]);
    });
    es.addEventListener("done", () => {
      es.close();
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
      setStatus("error");
      setError(message);
      es.close();
    });

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [open, techId, techName, router, onOpenChange]);

  // Belt-and-suspenders unmount cleanup (per the SSE-client convention).
  useEffect(() => () => sourceRef.current?.close(), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Installing {techName} driver</DialogTitle>
          <DialogDescription>
            Running npm install for the {techName} driver packages.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap">
          {log.join("\n") || "Starting…"}
        </pre>
        {status === "error" && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
