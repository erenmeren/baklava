"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Hammer } from "lucide-react";
import { cn } from "@/lib/utils";

const SAMPLE_DOCKERFILE = `FROM alpine:3.20
RUN apk add --no-cache curl
CMD ["echo", "hello from baklava-built image"]
`;

interface Props {
  connectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBuilt: () => void;
}

export function BuildImageDialog({
  connectionId,
  open,
  onOpenChange,
  onBuilt,
}: Props) {
  const [dockerfile, setDockerfile] = useState(SAMPLE_DOCKERFILE);
  const [tag, setTag] = useState("baklava-build:latest");
  const [building, setBuilding] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBuilding(false);
      setDone(false);
      setError(null);
      setLogs([]);
    }
  }, [open]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const start = async () => {
    if (!dockerfile.trim() || !tag.trim()) return;
    setBuilding(true);
    setDone(false);
    setError(null);
    setLogs([]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(
        `/api/docker/${connectionId}/images/build-stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dockerfile, tag: tag.trim() }),
          signal: ac.signal,
        }
      );
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "Build failed");
        setError(txt);
        setBuilding(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += dec.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const lines = block.split("\n");
          let event = "message";
          let data = "";
          for (const ln of lines) {
            if (ln.startsWith("event:")) event = ln.slice(6).trim();
            else if (ln.startsWith("data:")) data = ln.slice(5).trim();
          }
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (event === "progress") {
              const stream = parsed.stream || parsed.status;
              if (stream) {
                const text = String(stream).replace(/\n+$/, "");
                if (text) setLogs((prev) => [...prev, text]);
              }
            } else if (event === "done") {
              setDone(true);
              setBuilding(false);
              toast.success("Image built", { description: tag.trim() });
              onBuilt();
            } else if (event === "error") {
              setError(parsed.message || "build failed");
              setBuilding(false);
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
      setBuilding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hammer className="size-4 text-brand" />
            Build image from Dockerfile
          </DialogTitle>
          <DialogDescription>
            Paste a Dockerfile, give it a tag, and Baklava streams{" "}
            <span className="font-mono">docker build</span> output as it runs.
            No build context — Dockerfile only (no <span className="font-mono">COPY</span>{" "}
            / <span className="font-mono">ADD</span> from local files).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 flex-1 min-h-0 flex flex-col">
          <div className="space-y-2">
            <Label htmlFor="build-tag">Tag</Label>
            <Input
              id="build-tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="my-image:latest"
              spellCheck={false}
              disabled={building}
            />
          </div>
          <div className="space-y-2 flex-1 min-h-0 flex flex-col">
            <Label htmlFor="build-dockerfile">Dockerfile</Label>
            <Textarea
              id="build-dockerfile"
              value={dockerfile}
              onChange={(e) => setDockerfile(e.target.value)}
              rows={8}
              className="font-mono text-xs flex-1"
              spellCheck={false}
              disabled={building}
            />
          </div>

          {logs.length > 0 || error || done ? (
            <div
              ref={logRef}
              className={cn(
                "rounded-md bg-zinc-950 text-zinc-100 p-3 font-mono text-[11px] leading-relaxed overflow-auto max-h-[28vh] min-h-[120px]",
                done && "border border-emerald-500/40"
              )}
            >
              {logs.map((l, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {l}
                </div>
              ))}
              {error ? <div className="text-red-400">{error}</div> : null}
              {done ? (
                <div className="text-emerald-400 mt-2">
                  ✓ built {tag.trim()}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              abortRef.current?.abort();
              onOpenChange(false);
            }}
            disabled={building && !done && !error}
          >
            {building ? "Cancel" : done ? "Close" : "Cancel"}
          </Button>
          <Button
            onClick={start}
            disabled={
              building || !dockerfile.trim() || !tag.trim()
            }
          >
            {building ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Hammer className="size-3.5" />
            )}
            {done ? "Build again" : "Build"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
