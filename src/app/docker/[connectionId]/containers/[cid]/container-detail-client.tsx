"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { formatBytes } from "@/components/workspace/format";
import { RefreshButton } from "@/components/workspace/auto-refresh";
import { NetworksTab } from "./tabs/networks-tab";
import { FilesTab } from "./tabs/files-tab";
import { TerminalTab } from "./tabs/terminal-tab";
import { LogsTab } from "./tabs/logs-tab";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  PauseIcon,
  Play,
  RotateCcw,
  Square,
  TerminalSquare,
  Trash2,
} from "lucide-react";
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
import { useRouter } from "next/navigation";

interface NetworkAttachment {
  NetworkID?: string;
  IPAddress?: string;
  Gateway?: string;
  MacAddress?: string;
  Aliases?: string[] | null;
}

interface ContainerInspect {
  Id: string;
  Name: string;
  State: {
    Status: string;
    Running: boolean;
    Paused?: boolean;
    StartedAt: string;
  };
  Config: { Image: string; Env?: string[]; Cmd?: string[] };
  HostConfig?: { PortBindings?: Record<string, unknown> };
  NetworkSettings?: {
    IPAddress?: string;
    Networks?: Record<string, NetworkAttachment>;
  };
  Mounts?: { Source: string; Destination: string; Mode: string; Type: string }[];
}

interface Stats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
  pids: number;
}

interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface Props {
  connectionId: string;
  cid: string;
}

export function ContainerDetailClient({ connectionId, cid }: Props) {
  const router = useRouter();
  const [inspect, setInspect] = useState<ContainerInspect | null>(null);
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [execCmd, setExecCmd] = useState("ls -la");
  const [execShell, setExecShell] = useState("/bin/sh");
  const [execResult, setExecResult] = useState<ExecResult | null>(null);
  const [execErr, setExecErr] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  const loadInspect = useCallback(async () => {
    const res = await fetch(`/api/docker/${connectionId}/containers/${cid}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setInspect(data as ContainerInspect);
  }, [connectionId, cid]);

  useEffect(() => {
    loadInspect();
  }, [loadInspect]);

  const loadStats = useCallback(async () => {
    setStatsErr(null);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/containers/${cid}/stats`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) setStats(data as Stats);
      else setStatsErr(data.error || "Could not read stats");
    } catch (e) {
      setStatsErr(e instanceof Error ? e.message : String(e));
    }
  }, [connectionId, cid]);

  useEffect(() => {
    if (tab !== "stats") return;
    loadStats();
    const i = setInterval(loadStats, 3000);
    return () => clearInterval(i);
  }, [tab, loadStats]);

  const runExec = async () => {
    if (!execCmd.trim()) return;
    setExecuting(true);
    setExecErr(null);
    setExecResult(null);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/containers/${cid}/exec`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command: execCmd, shell: execShell }),
        }
      );
      const data = await res.json();
      if (res.ok) setExecResult(data as ExecResult);
      else setExecErr(data.error || "Exec failed");
    } catch (e) {
      setExecErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  };

  const act = async (
    action: "start" | "stop" | "restart" | "pause" | "unpause" | "kill"
  ) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/containers/${cid}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(`Container ${action}`);
        await loadInspect();
      } else toast.error(data.error || `Could not ${action}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/containers/${cid}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Container removed");
        router.push(`/docker/${connectionId}/containers`);
      } else toast.error(data.error || "Could not remove");
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  const running = inspect?.State.Running;
  const paused = inspect?.State.Paused;
  const name = inspect?.Name?.replace(/^\//, "") ?? cid.slice(0, 12);

  return (
    <WorkspacePage
      title={name}
      description={
        inspect ? (
          <span className="inline-flex items-center gap-2">
            <Badge
              variant={running ? "default" : "secondary"}
              className="font-mono"
            >
              {inspect.State.Status}
            </Badge>
            <span className="font-mono text-xs">{inspect.Config.Image}</span>
          </span>
        ) : undefined
      }
      actions={
        <>
          <Link
            href={`/docker/${connectionId}/containers`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          {running ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => act("restart")}
                disabled={busy}
              >
                <RotateCcw className="size-3.5" />
                Restart
              </Button>
              {paused ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act("unpause")}
                  disabled={busy}
                >
                  <Play className="size-3.5" />
                  Unpause
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act("pause")}
                  disabled={busy}
                >
                  <PauseIcon className="size-3.5" />
                  Pause
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => act("stop")}
                disabled={busy}
              >
                <Square className="size-3.5" />
                Stop
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => act("start")} disabled={busy}>
              <Play className="size-3.5" />
              Start
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmRemove(true)}
            disabled={busy}
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="exec">Exec</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="networks">Networks</TabsTrigger>
          <TabsTrigger value="env">Environment</TabsTrigger>
          <TabsTrigger value="mounts">Mounts</TabsTrigger>
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          {inspect ? (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">ID</dt>
              <dd className="font-mono text-xs break-all">{inspect.Id}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>{inspect.State.Status}</dd>
              <dt className="text-muted-foreground">Started</dt>
              <dd className="font-mono text-xs">{inspect.State.StartedAt}</dd>
              <dt className="text-muted-foreground">Image</dt>
              <dd className="font-mono text-xs">{inspect.Config.Image}</dd>
              <dt className="text-muted-foreground">Command</dt>
              <dd className="font-mono text-xs">
                {(inspect.Config.Cmd || []).join(" ") || (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </dd>
              <dt className="text-muted-foreground">IP</dt>
              <dd className="font-mono text-xs">
                {inspect.NetworkSettings?.IPAddress || (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Networks</dt>
              <dd className="font-mono text-xs">
                {Object.keys(inspect.NetworkSettings?.Networks || {}).join(
                  ", "
                ) || <span className="text-muted-foreground/50">—</span>}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </TabsContent>

        <TabsContent value="logs" className="pt-4">
          <LogsTab
            connectionId={connectionId}
            cid={cid}
            active={tab === "logs"}
            onOpenTerminal={() => setTab("terminal")}
          />
        </TabsContent>

        <TabsContent value="stats" className="pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Live stats · refreshes every 3s
            </p>
            <RefreshButton onClick={loadStats} />
          </div>
          {statsErr ? (
            <p className="text-sm text-destructive font-mono break-words">
              {statsErr}
            </p>
          ) : null}
          {!stats && !statsErr ? (
            <p className="text-sm text-muted-foreground">
              {running
                ? "Reading stats…"
                : "Container is not running — no stats."}
            </p>
          ) : null}
          {stats ? (
            <div className="grid sm:grid-cols-2 gap-4">
              <StatBlock
                label="CPU"
                value={`${stats.cpuPercent.toFixed(1)}%`}
                pct={stats.cpuPercent}
              />
              <StatBlock
                label="Memory"
                value={`${formatBytes(stats.memoryUsage)} / ${formatBytes(stats.memoryLimit)}`}
                sub={`${stats.memoryPercent.toFixed(1)}%`}
                pct={stats.memoryPercent}
              />
              <StatBlock
                label="Network"
                value={`↓ ${formatBytes(stats.networkRx)} · ↑ ${formatBytes(stats.networkTx)}`}
              />
              <StatBlock
                label="Block I/O"
                value={`R ${formatBytes(stats.blockRead)} · W ${formatBytes(stats.blockWrite)}`}
              />
              <StatBlock label="PIDs" value={String(stats.pids)} />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="exec" className="pt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Run a single command inside this container. Output prints below
            once the command exits.
          </p>
          <div className="grid grid-cols-[140px_1fr_auto] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="exec-shell" className="text-[10px] uppercase tracking-wider">
                Shell
              </Label>
              <select
                id="exec-shell"
                value={execShell}
                onChange={(e) => setExecShell(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs font-mono shadow-xs"
              >
                <option value="/bin/sh">/bin/sh</option>
                <option value="/bin/bash">/bin/bash</option>
                <option value="/bin/ash">/bin/ash</option>
                <option value="/bin/zsh">/bin/zsh</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exec-cmd" className="text-[10px] uppercase tracking-wider">
                Command
              </Label>
              <Input
                id="exec-cmd"
                value={execCmd}
                onChange={(e) => setExecCmd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runExec()}
                spellCheck={false}
                className="font-mono"
                disabled={executing || !running}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={runExec}
                disabled={executing || !running || !execCmd.trim()}
              >
                {executing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <TerminalSquare className="size-3.5" />
                )}
                Run
              </Button>
            </div>
          </div>
          {!running ? (
            <p className="text-xs text-muted-foreground">
              Container is not running — start it to exec.
            </p>
          ) : null}
          {execErr ? (
            <p className="text-sm text-destructive font-mono break-words">
              {execErr}
            </p>
          ) : null}
          {execResult ? (
            <div className="space-y-2">
              <div className="text-xs font-mono text-muted-foreground">
                exit code:{" "}
                <span
                  className={
                    execResult.exitCode === 0
                      ? "text-emerald-500"
                      : "text-destructive"
                  }
                >
                  {execResult.exitCode ?? "—"}
                </span>
              </div>
              {execResult.stdout ? (
                <pre className="bg-zinc-950 text-zinc-100 rounded-md p-3 font-mono text-xs whitespace-pre-wrap overflow-auto max-h-[40vh]">
                  {execResult.stdout}
                </pre>
              ) : null}
              {execResult.stderr ? (
                <pre className="bg-zinc-950 text-red-300 rounded-md p-3 font-mono text-xs whitespace-pre-wrap overflow-auto max-h-[20vh]">
                  {execResult.stderr}
                </pre>
              ) : null}
              {!execResult.stdout && !execResult.stderr ? (
                <p className="text-xs text-muted-foreground italic">
                  (no output)
                </p>
              ) : null}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="terminal" className="pt-4">
          <TerminalTab
            connectionId={connectionId}
            cid={cid}
            running={Boolean(running)}
            active={tab === "terminal"}
          />
        </TabsContent>

        <TabsContent value="files" className="pt-4">
          <FilesTab
            connectionId={connectionId}
            cid={cid}
            running={Boolean(running)}
          />
        </TabsContent>

        <TabsContent value="networks" className="pt-4">
          <NetworksTab
            connectionId={connectionId}
            cid={cid}
            networks={inspect?.NetworkSettings?.Networks}
            onChange={loadInspect}
          />
        </TabsContent>

        <TabsContent value="env" className="pt-4">
          {inspect?.Config.Env?.length ? (
            <ul className="space-y-1 font-mono text-xs">
              {inspect.Config.Env.map((e, i) => {
                const eq = e.indexOf("=");
                const k = eq >= 0 ? e.slice(0, eq) : e;
                const v = eq >= 0 ? e.slice(eq + 1) : "";
                return (
                  <li
                    key={i}
                    className="flex gap-3 border-b border-border/40 py-1"
                  >
                    <span className="text-muted-foreground shrink-0">{k}</span>
                    <span className="break-all">{v}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No environment.</p>
          )}
        </TabsContent>

        <TabsContent value="mounts" className="pt-4">
          {inspect?.Mounts?.length ? (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left bg-muted/50">
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Source</th>
                    <th className="px-3 py-2 font-semibold">Destination</th>
                    <th className="px-3 py-2 font-semibold">Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {inspect.Mounts.map((m, i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="px-3 py-2">{m.Type}</td>
                      <td className="px-3 py-2 break-all">{m.Source}</td>
                      <td className="px-3 py-2 break-all">{m.Destination}</td>
                      <td className="px-3 py-2">{m.Mode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No mounts.</p>
          )}
        </TabsContent>

        <TabsContent value="inspect" className="pt-4">
          <pre className="bg-zinc-950 text-zinc-100 rounded-md p-3 font-mono text-xs overflow-auto max-h-[60vh]">
            {inspect ? JSON.stringify(inspect, null, 2) : "Loading…"}
          </pre>
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove container?</AlertDialogTitle>
            <AlertDialogDescription>
              This will force-remove <span className="font-mono">{name}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

function StatBlock({
  label,
  value,
  sub,
  pct,
}: {
  label: string;
  value: string;
  sub?: string;
  pct?: number;
}) {
  const clamped = pct == null ? null : Math.max(0, Math.min(100, pct));
  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm">{value}</div>
      {sub ? (
        <div className="text-[10px] font-mono text-muted-foreground">
          {sub}
        </div>
      ) : null}
      {clamped != null ? (
        <div className="h-1 rounded-full bg-foreground/5 overflow-hidden">
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${clamped}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
