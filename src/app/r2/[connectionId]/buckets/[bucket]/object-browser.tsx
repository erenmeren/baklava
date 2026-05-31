"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Download,
  Folder,
  FileText,
  Link2,
  Loader2,
  Pencil,
  RefreshCcw,
  Trash2,
  Upload as UploadIcon,
  FolderPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ObjectEntry {
  key: string;
  name: string;
  size: number;
  lastModified: number | null;
  storageClass: string | null;
}
interface Listing {
  prefix: string;
  folders: string[];
  objects: ObjectEntry[];
  nextToken: string | null;
}

function fmtSize(b: number) {
  if (!b) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

interface Props {
  connectionId: string;
  bucket: string;
}

export function ObjectBrowser({ connectionId, bucket }: Props) {
  const [prefix, setPrefix] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<ObjectEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const apiBase = `/api/r2/${connectionId}/buckets/${encodeURIComponent(bucket)}`;

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      setSelected(new Set());
      try {
        const res = await fetch(
          `${apiBase}/objects?prefix=${encodeURIComponent(p)}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (res.ok) setListing(data as Listing);
        else toast.error("List failed", { description: data.error });
      } finally {
        setLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    load(prefix);
  }, [load, prefix]);

  const crumbs = prefix ? prefix.replace(/\/$/, "").split("/") : [];

  const upload = async (files: FileList) => {
    setWorking(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("key", `${prefix}${file.name}`);
        const res = await fetch(`${apiBase}/objects/upload`, {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(`Upload failed: ${file.name}`, { description: data.error });
        }
      }
      toast.success("Upload complete");
      load(prefix);
    } finally {
      setWorking(false);
    }
  };

  const download = (key: string) => {
    window.location.href = `${apiBase}/objects/download?key=${encodeURIComponent(key)}`;
  };

  const copyLink = async (key: string) => {
    const res = await fetch(`${apiBase}/objects/presign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    if (res.ok) {
      await navigator.clipboard.writeText(data.url);
      toast.success("Presigned link copied (1h)");
    } else {
      toast.error("Presign failed", { description: data.error });
    }
  };

  const removeKeys = async (keys: string[]) => {
    setWorking(true);
    try {
      const res = await fetch(`${apiBase}/objects`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Deleted ${keys.length} object(s)`);
        load(prefix);
      } else {
        toast.error("Delete failed", { description: data.error });
      }
    } finally {
      setWorking(false);
    }
  };

  const doRename = async () => {
    if (!renameTarget) return;
    setWorking(true);
    try {
      const to = `${prefix}${renameValue.trim()}`;
      const res = await fetch(`${apiBase}/objects/copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: renameTarget.key, to, move: true }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Renamed");
        setRenameTarget(null);
        load(prefix);
      } else {
        toast.error("Rename failed", { description: data.error });
      }
    } finally {
      setWorking(false);
    }
  };

  const createFolder = async () => {
    setWorking(true);
    try {
      // A folder is a zero-byte object whose key ends with "/".
      const form = new FormData();
      form.append("file", new Blob([], { type: "application/x-directory" }));
      form.append("key", `${prefix}${folderName.trim().replace(/\/+$/, "")}/`);
      const res = await fetch(`${apiBase}/objects/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Folder created");
        setFolderOpen(false);
        setFolderName("");
        load(prefix);
      } else {
        toast.error("Create folder failed", { description: data.error });
      }
    } finally {
      setWorking(false);
    }
  };

  const toggleSel = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={working}>
          <UploadIcon className="size-3.5" />
          Upload
        </Button>
        <Button size="sm" variant="outline" onClick={() => setFolderOpen(true)}>
          <FolderPlus className="size-3.5" />
          New folder
        </Button>
        {selected.size > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => removeKeys([...selected])}
            disabled={working}
          >
            <Trash2 className="size-3.5" />
            Delete ({selected.size})
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => load(prefix)}
          disabled={loading}
          className="ml-auto"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="size-3.5" />
          )}
        </Button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground flex-wrap">
        <button
          className="hover:text-foreground"
          onClick={() => setPrefix("")}
        >
          {bucket}
        </button>
        {crumbs.map((c, i) => {
          const p = crumbs.slice(0, i + 1).join("/") + "/";
          return (
            <span key={p} className="flex items-center gap-1">
              <ChevronRight className="size-3" />
              <button className="hover:text-foreground" onClick={() => setPrefix(p)}>
                {c}
              </button>
            </span>
          );
        })}
      </div>

      {/* Listing */}
      <div className="flex-1 min-h-0 overflow-auto border rounded-md">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="w-8 px-2 py-1.5"></th>
              <th className="px-2 py-1.5">Name</th>
              <th className="px-2 py-1.5 text-right">Size</th>
              <th className="px-2 py-1.5">Modified</th>
              <th className="w-px px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {listing?.folders.map((f) => {
              const name = f.slice(prefix.length).replace(/\/$/, "");
              return (
                <tr
                  key={f}
                  className="border-b hover:bg-foreground/5 cursor-pointer"
                  onClick={() => setPrefix(f)}
                >
                  <td className="px-2 py-1.5"></td>
                  <td className="px-2 py-1.5 font-mono">
                    <span className="inline-flex items-center gap-1.5">
                      <Folder className="size-3.5 text-muted-foreground" />
                      {name}/
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">—</td>
                  <td className="px-2 py-1.5 text-muted-foreground">—</td>
                  <td></td>
                </tr>
              );
            })}
            {listing?.objects.map((o) => (
              <tr
                key={o.key}
                className={cn(
                  "border-b hover:bg-foreground/5",
                  selected.has(o.key) && "bg-foreground/5",
                )}
              >
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={selected.has(o.key)}
                    onChange={() => toggleSel(o.key)}
                  />
                </td>
                <td className="px-2 py-1.5 font-mono">
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="size-3.5 text-muted-foreground" />
                    {o.name}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                  {fmtSize(o.size)}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground tabular-nums">
                  {o.lastModified
                    ? new Date(o.lastModified).toLocaleString()
                    : "—"}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-0.5 justify-end">
                    <Button size="icon-xs" variant="ghost" title="Download" onClick={() => download(o.key)}>
                      <Download className="size-3" />
                    </Button>
                    <Button size="icon-xs" variant="ghost" title="Copy link" onClick={() => copyLink(o.key)}>
                      <Link2 className="size-3" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="Rename"
                      onClick={() => {
                        setRenameTarget(o);
                        setRenameValue(o.name);
                      }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="Delete"
                      className="text-destructive"
                      onClick={() => removeKeys([o.key])}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {listing && listing.folders.length === 0 && listing.objects.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                  (empty)
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {listing?.nextToken ? (
        <p className="text-[11px] text-muted-foreground">
          Showing first 1000 entries — refine via folders to see more.
        </p>
      ) : null}

      {/* New folder dialog */}
      <Dialog open={folderOpen} onOpenChange={(v) => !working && setFolderOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <Input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="folder-name"
            spellCheck={false}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderOpen(false)} disabled={working}>
              Cancel
            </Button>
            <Button onClick={createFolder} disabled={working || !folderName.trim()}>
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(v) => !working && !v && setRenameTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename object</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            spellCheck={false}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={working}>
              Cancel
            </Button>
            <Button onClick={doRename} disabled={working || !renameValue.trim()}>
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
