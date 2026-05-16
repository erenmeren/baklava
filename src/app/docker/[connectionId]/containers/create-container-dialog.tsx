"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";

interface Props {
  connectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface ImageRef {
  id: string;
  repoTags: string[];
}

type RestartPolicy = "no" | "on-failure" | "always" | "unless-stopped";

export function CreateContainerDialog({
  connectionId,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const router = useRouter();
  const [images, setImages] = useState<ImageRef[]>([]);
  const [image, setImage] = useState("");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [restart, setRestart] = useState<RestartPolicy>("unless-stopped");
  const [autoStart, setAutoStart] = useState(true);
  const [ports, setPorts] = useState<
    { container: string; host: string; protocol: "tcp" | "udp" }[]
  >([{ container: "", host: "", protocol: "tcp" }]);
  const [env, setEnv] = useState<{ key: string; value: string }[]>([
    { key: "", value: "" },
  ]);
  const [volumes, setVolumes] = useState<
    { source: string; target: string; readOnly: boolean }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadImages = useCallback(async () => {
    try {
      const res = await fetch(`/api/docker/${connectionId}/images`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setImages(data.images as ImageRef[]);
    } catch {
      // ignore
    }
  }, [connectionId]);

  useEffect(() => {
    if (open) loadImages();
  }, [open, loadImages]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setImage("");
      setName("");
      setCommand("");
      setPorts([{ container: "", host: "", protocol: "tcp" }]);
      setEnv([{ key: "", value: "" }]);
      setVolumes([]);
      setError(null);
      setRestart("unless-stopped");
      setAutoStart(true);
    }
  }, [open]);

  const create = async () => {
    if (!image.trim()) {
      setError("Image is required");
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const payload = {
        image: image.trim(),
        name: name.trim() || undefined,
        command: command.trim() || undefined,
        env: env.filter((e) => e.key.trim()),
        ports: ports
          .filter((p) => p.container.trim())
          .map((p) => ({
            container: Number(p.container),
            host: p.host.trim() ? Number(p.host) : undefined,
            protocol: p.protocol,
          })),
        volumes: volumes.filter((v) => v.source.trim() && v.target.trim()),
        restartPolicy: restart,
        autoStart,
      };
      const res = await fetch(`/api/docker/${connectionId}/containers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Container created", {
          description: data.id?.slice(0, 12),
        });
        onCreated();
        onOpenChange(false);
        if (data.id) {
          router.push(`/docker/${connectionId}/containers/${data.id}`);
        }
      } else {
        setError(data.error || "Create failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const imageOptions = images
    .flatMap((i) => i.repoTags)
    .filter((t) => t && t !== "<none>:<none>");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create container</DialogTitle>
          <DialogDescription>
            Configure and run a new container from a local image. Pull an image
            first via the Images tab if you need a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Image */}
          <div className="space-y-2">
            <Label htmlFor="cc-image">
              Image <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cc-image"
              list="cc-image-list"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="postgres:16-alpine"
              spellCheck={false}
              autoFocus
            />
            <datalist id="cc-image-list">
              {imageOptions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            {imageOptions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No local images yet. You can still type a reference and Docker
                will pull on create — or use{" "}
                <span className="font-mono">Search Hub</span> from Images.
              </p>
            ) : null}
          </div>

          {/* Name + restart */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cc-name">Name (optional)</Label>
              <Input
                id="cc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-container"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cc-restart">Restart policy</Label>
              <select
                id="cc-restart"
                value={restart}
                onChange={(e) => setRestart(e.target.value as RestartPolicy)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                <option value="no">no</option>
                <option value="on-failure">on-failure</option>
                <option value="always">always</option>
                <option value="unless-stopped">unless-stopped</option>
              </select>
            </div>
          </div>

          {/* Command */}
          <div className="space-y-2">
            <Label htmlFor="cc-cmd">Command (optional)</Label>
            <Input
              id="cc-cmd"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder='e.g. "sh -c '
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">
              Override the image&rsquo;s default command. Quoted segments are
              kept together.
            </p>
          </div>

          {/* Ports */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Port mappings</Label>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setPorts([
                    ...ports,
                    { container: "", host: "", protocol: "tcp" },
                  ])
                }
              >
                <Plus className="size-3" /> Add
              </Button>
            </div>
            {ports.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_90px_28px] gap-2">
                <Input
                  placeholder="host"
                  value={p.host}
                  onChange={(e) => {
                    const next = [...ports];
                    next[i] = { ...p, host: e.target.value };
                    setPorts(next);
                  }}
                  inputMode="numeric"
                />
                <Input
                  placeholder="container"
                  value={p.container}
                  onChange={(e) => {
                    const next = [...ports];
                    next[i] = { ...p, container: e.target.value };
                    setPorts(next);
                  }}
                  inputMode="numeric"
                />
                <select
                  value={p.protocol}
                  onChange={(e) => {
                    const next = [...ports];
                    next[i] = { ...p, protocol: e.target.value as "tcp" | "udp" };
                    setPorts(next);
                  }}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs"
                >
                  <option value="tcp">tcp</option>
                  <option value="udp">udp</option>
                </select>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() =>
                    setPorts(ports.filter((_, j) => j !== i))
                  }
                  disabled={ports.length === 1}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>

          {/* Env */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Environment</Label>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setEnv([...env, { key: "", value: "" }])}
              >
                <Plus className="size-3" /> Add
              </Button>
            </div>
            {env.map((e, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr_28px] gap-2">
                <Input
                  placeholder="KEY"
                  value={e.key}
                  onChange={(ev) => {
                    const next = [...env];
                    next[i] = { ...e, key: ev.target.value };
                    setEnv(next);
                  }}
                  spellCheck={false}
                  className="font-mono"
                />
                <Input
                  placeholder="value"
                  value={e.value}
                  onChange={(ev) => {
                    const next = [...env];
                    next[i] = { ...e, value: ev.target.value };
                    setEnv(next);
                  }}
                  spellCheck={false}
                  className="font-mono"
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setEnv(env.filter((_, j) => j !== i))}
                  disabled={env.length === 1}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>

          {/* Volumes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Volume mounts</Label>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setVolumes([
                    ...volumes,
                    { source: "", target: "", readOnly: false },
                  ])
                }
              >
                <Plus className="size-3" /> Add
              </Button>
            </div>
            {volumes.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                None. Mounts can be host paths or named volumes.
              </p>
            ) : null}
            {volumes.map((v, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_70px_28px] gap-2">
                <Input
                  placeholder="source (host path or volume)"
                  value={v.source}
                  onChange={(e) => {
                    const next = [...volumes];
                    next[i] = { ...v, source: e.target.value };
                    setVolumes(next);
                  }}
                  spellCheck={false}
                />
                <Input
                  placeholder="container path"
                  value={v.target}
                  onChange={(e) => {
                    const next = [...volumes];
                    next[i] = { ...v, target: e.target.value };
                    setVolumes(next);
                  }}
                  spellCheck={false}
                />
                <label className="flex items-center justify-center gap-1 text-xs text-muted-foreground border border-input rounded-md cursor-pointer">
                  <input
                    type="checkbox"
                    checked={v.readOnly}
                    onChange={(e) => {
                      const next = [...volumes];
                      next[i] = { ...v, readOnly: e.target.checked };
                      setVolumes(next);
                    }}
                  />
                  ro
                </label>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setVolumes(volumes.filter((_, j) => j !== i))}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm">
            <Label htmlFor="auto-start" className="cursor-pointer">
              Start immediately after creation
            </Label>
            <Switch
              id="auto-start"
              checked={autoStart}
              onCheckedChange={setAutoStart}
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not create</AlertTitle>
              <AlertDescription className="break-words">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button onClick={create} disabled={creating || !image.trim()}>
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create &amp; run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
