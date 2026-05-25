"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/components/workspace/format";
import { RelativeTime } from "@/components/workspace/relative-time";
import { RefreshButton } from "@/components/workspace/auto-refresh";
import { toast } from "sonner";
import {
  ArrowUp,
  ChevronRight,
  FileText,
  FolderOpen,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Entry {
  type: "file" | "dir" | "link" | "other";
  name: string;
  size: number;
  mtime: number;
  target?: string;
}

interface ListResult {
  path: string;
  entries: Entry[];
}

interface CatResult {
  path: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  text: string;
}

interface Props {
  connectionId: string;
  cid: string;
  running: boolean;
}

function joinPath(base: string, name: string): string {
  if (base === "/") return `/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function parentPath(path: string): string {
  if (path === "/" || !path) return "/";
  const parts = path.replace(/\/+$/, "").split("/");
  parts.pop();
  return parts.length <= 1 ? "/" : parts.join("/");
}

export function FilesTab({ connectionId, cid, running }: Props) {
  const [path, setPath] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewing, setViewing] = useState<{ path: string; result: CatResult } | null>(
    null
  );
  const [catLoading, setCatLoading] = useState(false);

  const list = useCallback(
    async (target: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/docker/${connectionId}/containers/${cid}/fs/list`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: target }),
          }
        );
        const body = await res.json();
        if (res.ok) {
          setData(body as ListResult);
          setPath(target);
          setPathInput(target);
        } else {
          setError(body.error || "Could not list");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [connectionId, cid]
  );

  useEffect(() => {
    if (running) list("/");
  }, [running, list]);

  const view = async (filePath: string) => {
    setCatLoading(true);
    setViewing(null);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/containers/${cid}/fs/cat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: filePath }),
        }
      );
      const body = await res.json();
      if (res.ok) setViewing({ path: filePath, result: body as CatResult });
      else toast.error("Could not open", { description: body.error });
    } finally {
      setCatLoading(false);
    }
  };

  const onEntry = (e: Entry) => {
    if (e.type === "dir") {
      list(joinPath(path, e.name));
    } else if (e.type === "link") {
      // Try following the link by listing it; if it's a dir we'll see entries.
      list(joinPath(path, e.name));
    } else {
      view(joinPath(path, e.name));
    }
  };

  if (!running) {
    return (
      <p className="text-sm text-muted-foreground">
        Container is not running — start it to browse the filesystem.
      </p>
    );
  }

  // Breadcrumb segments
  const segments = path === "/" ? [""] : path.split("/");
  const cumulative: { label: string; path: string }[] = [
    { label: "/", path: "/" },
  ];
  let acc = "";
  for (const s of segments) {
    if (!s) continue;
    acc += `/${s}`;
    cumulative.push({ label: s, path: acc });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => list(parentPath(path))}
          disabled={loading || path === "/"}
          title="Up"
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" && list(pathInput.trim() || "/")
          }
          spellCheck={false}
          className="font-mono text-xs"
          placeholder="/"
        />
        <RefreshButton onClick={() => list(path)} loading={loading} />
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono flex-wrap">
        {cumulative.map((c, i) => (
          <span key={c.path} className="inline-flex items-center gap-1">
            {i > 0 ? (
              <ChevronRight className="size-3 text-muted-foreground/50" />
            ) : null}
            <button
              onClick={() => list(c.path)}
              className={cn(
                "hover:text-foreground transition-colors",
                i === cumulative.length - 1 && "text-foreground"
              )}
            >
              {c.label || "/"}
            </button>
          </span>
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs font-mono text-destructive break-words">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : data && data.entries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          (empty)
        </div>
      ) : data ? (
        <div className="rounded-lg border border-border/60 overflow-hidden divide-y divide-border/30">
          {data.entries.map((e) => {
            const Icon =
              e.type === "dir"
                ? FolderOpen
                : e.type === "link"
                  ? Link2
                  : FileText;
            return (
              <button
                key={e.name}
                onClick={() => onEntry(e)}
                className="w-full px-4 py-2 grid grid-cols-[20px_1fr_120px_140px] gap-3 items-center text-left hover:bg-foreground/[0.03] transition-colors"
              >
                <Icon
                  className={cn(
                    "size-3.5",
                    e.type === "dir" ? "text-brand" : "text-muted-foreground"
                  )}
                />
                <span className="font-mono text-xs truncate">
                  {e.name}
                  {e.target ? (
                    <span className="text-muted-foreground/70">
                      {" → "}
                      {e.target}
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground text-right">
                  {e.type === "dir" ? "—" : formatBytes(e.size)}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground text-right">
                  {e.mtime > 0 ? <RelativeTime value={e.mtime * 1000} /> : "—"}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* File viewer */}
      <Dialog
        open={Boolean(viewing) || catLoading}
        onOpenChange={(o) => {
          if (!o) {
            setViewing(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-base break-all">
              {viewing?.path}
            </DialogTitle>
            <DialogDescription>
              {viewing?.result.binary
                ? "Binary file — preview unavailable."
                : viewing
                  ? `${formatBytes(viewing.result.size)}${viewing.result.truncated ? " · truncated to 64 KB" : ""}`
                  : "Loading…"}
            </DialogDescription>
          </DialogHeader>
          {catLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : viewing && !viewing.result.binary ? (
            <pre className="flex-1 min-h-0 overflow-auto bg-zinc-950 text-zinc-100 rounded-md p-3 font-mono text-xs whitespace-pre-wrap break-all">
              {viewing.result.text}
            </pre>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
