"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  PlayCircle,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SseFrameParser } from "@/lib/sse-client";

const SAMPLE_COMPOSE = `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    depends_on:
      - cache
  cache:
    image: redis:7-alpine
    volumes:
      - cache-data:/data

volumes:
  cache-data:
`;

interface ValidatedService {
  name: string;
  image: string;
  ports: { host?: number; container: number; protocol: string }[];
  envCount: number;
  mounts: number;
  networks: string[];
  dependsOn: string[];
  restart?: string;
}

interface ValidatedNetwork {
  name: string;
  alias: string;
  driver: string;
  external: boolean;
}

interface ValidatedVolume {
  name: string;
  alias: string;
  driver: string;
  external: boolean;
}

interface ValidateResponse {
  ok: boolean;
  stack?: string;
  services?: ValidatedService[];
  networks?: ValidatedNetwork[];
  volumes?: ValidatedVolume[];
  warnings?: string[];
  errors?: { message: string }[];
  error?: string;
}

interface DeployStatus {
  service: string;
  status: string;
}

interface Props {
  connectionId: string;
}

export function NewStackClient({ connectionId }: Props) {
  const router = useRouter();
  const [name, setName] = useState("demo");
  const [compose, setCompose] = useState(SAMPLE_COMPOSE);
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState<ValidateResponse | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [phase, setPhase] = useState<string>("idle");
  const [serviceStatuses, setServiceStatuses] = useState<DeployStatus[]>([]);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployDone, setDeployDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const validate = async () => {
    if (!name.trim() || !compose.trim()) return;
    setValidating(true);
    setValidated(null);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/stacks/validate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim(), compose }),
        }
      );
      const data = (await res.json()) as ValidateResponse;
      setValidated(data);
      if (data.ok) {
        toast.success(
          `Compose looks good · ${data.services?.length ?? 0} service(s)`
        );
      } else {
        toast.error("Compose has errors");
      }
    } catch (e) {
      toast.error("Validate failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setValidating(false);
    }
  };

  const deploy = async () => {
    if (!name.trim() || !compose.trim()) return;
    setDeploying(true);
    setDeployDone(false);
    setDeployError(null);
    setLogs([]);
    setPhase("starting");
    setServiceStatuses([]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`/api/docker/${connectionId}/stacks/deploy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), compose }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "deploy failed");
        setDeployError(txt);
        setDeploying(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      const parser = new SseFrameParser();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const frame of parser.push(dec.decode(value, { stream: true }))) {
          const parsed = frame.data as Record<string, string>;
          if (frame.event === "phase") {
            setPhase(parsed.phase);
            setLogs((prev) => [...prev, `· phase: ${parsed.phase}`]);
            if (parsed.phase === "done") {
              setDeployDone(true);
              setDeploying(false);
              toast.success(`Stack ${name.trim()} deployed`);
            }
          } else if (frame.event === "log") {
            setLogs((prev) => [
              ...prev,
              `${parsed.level === "warn" ? "! " : "  "}${parsed.message}`,
            ]);
          } else if (frame.event === "service") {
            setServiceStatuses((prev) => {
              const others = prev.filter((s) => s.service !== parsed.service);
              return [
                ...others,
                { service: parsed.service, status: parsed.status },
              ];
            });
            setLogs((prev) => [
              ...prev,
              `  ${parsed.service}: ${parsed.status}`,
            ]);
          } else if (frame.event === "error") {
            setDeployError(parsed.message || "deploy failed");
            setDeploying(false);
            setLogs((prev) => [...prev, `× ${parsed.message}`]);
          }
          // Auto-scroll log
          requestAnimationFrame(() => {
            if (logRef.current) {
              logRef.current.scrollTop = logRef.current.scrollHeight;
            }
          });
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setDeployError(e instanceof Error ? e.message : String(e));
      setDeploying(false);
    }
  };

  const errors = validated?.errors ?? [];
  const warnings = validated?.warnings ?? [];
  const ok = validated?.ok === true;

  return (
    <WorkspacePage
      title="New stack"
      description="Paste a docker-compose.yml, validate, and deploy."
      actions={
        <Link
          href={`/docker/${connectionId}/stacks`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to stacks
        </Link>
      }
    >
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left: editor */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stack-name">Stack name</Label>
            <Input
              id="stack-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-stack"
              spellCheck={false}
              className="font-mono"
              disabled={deploying}
            />
            <p className="text-[11px] text-muted-foreground">
              Used as a prefix for created networks, volumes and containers.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="stack-compose">docker-compose.yml</Label>
            <Textarea
              id="stack-compose"
              value={compose}
              onChange={(e) => {
                setCompose(e.target.value);
                setValidated(null);
              }}
              rows={20}
              className="font-mono text-xs"
              spellCheck={false}
              disabled={deploying}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={validate}
              disabled={validating || deploying || !compose.trim() || !name.trim()}
            >
              {validating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              Validate
            </Button>
            <Button
              onClick={deploy}
              disabled={deploying || !ok}
            >
              {deploying ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PlayCircle className="size-3.5" />
              )}
              Deploy
            </Button>
            {deployDone ? (
              <Button
                variant="ghost"
                onClick={() =>
                  router.push(
                    `/docker/${connectionId}/stacks/${encodeURIComponent(name.trim())}`
                  )
                }
              >
                Open stack →
              </Button>
            ) : null}
          </div>
        </div>

        {/* Right: preview / progress */}
        <div className="space-y-4">
          {!validated ? (
            <Alert>
              <ShieldAlert className="size-4" />
              <AlertTitle>Validate first</AlertTitle>
              <AlertDescription>
                Click <span className="font-mono">Validate</span> to parse the
                compose file. You&rsquo;ll see the services, networks and
                volumes Baklava will create before deploying.
              </AlertDescription>
            </Alert>
          ) : null}

          {errors.length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>
                {errors.length} error{errors.length === 1 ? "" : "s"}
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 space-y-0.5">
                  {errors.map((e, i) => (
                    <li key={i} className="font-mono text-xs">
                      {e.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {ok && validated ? (
            <>
              <section className="rounded-lg border border-border/60 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/60 bg-muted/30 text-xs font-medium uppercase tracking-wider">
                  Services ({validated.services?.length ?? 0})
                </div>
                <ul className="divide-y divide-border/40">
                  {validated.services?.map((s) => (
                    <li
                      key={s.name}
                      className="px-4 py-2.5 grid grid-cols-[1fr_auto] items-baseline gap-3"
                    >
                      <div>
                        <div className="font-mono text-sm">{s.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground truncate">
                          {s.image}
                          {s.dependsOn.length
                            ? ` · after: ${s.dependsOn.join(", ")}`
                            : ""}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 justify-end">
                        {s.ports.map((p, i) => (
                          <Badge
                            key={`${i}`}
                            variant="secondary"
                            className="font-mono text-[10px]"
                          >
                            {p.host ? `${p.host}→` : ""}
                            {p.container}/{p.protocol}
                          </Badge>
                        ))}
                        {s.envCount ? (
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            {s.envCount} env
                          </Badge>
                        ) : null}
                        {s.mounts ? (
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            {s.mounts} vol
                          </Badge>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {(validated.networks?.length ?? 0) +
                (validated.volumes?.length ?? 0) >
              0 ? (
                <section className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                      Networks
                    </div>
                    {validated.networks?.length ? (
                      <ul className="text-xs font-mono space-y-1">
                        {validated.networks.map((n) => (
                          <li key={n.name} className="flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-brand" />
                            {n.name}
                            {n.external ? (
                              <Badge
                                variant="outline"
                                className="text-[9px] ml-1"
                              >
                                external
                              </Badge>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        none
                      </span>
                    )}
                  </div>
                  <div className="rounded-lg border border-border/60 p-3">
                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                      Volumes
                    </div>
                    {validated.volumes?.length ? (
                      <ul className="text-xs font-mono space-y-1">
                        {validated.volumes.map((v) => (
                          <li key={v.name} className="flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            {v.name}
                            {v.external ? (
                              <Badge
                                variant="outline"
                                className="text-[9px] ml-1"
                              >
                                external
                              </Badge>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        none
                      </span>
                    )}
                  </div>
                </section>
              ) : null}

              {warnings.length > 0 ? (
                <Alert>
                  <AlertTitle>Warnings</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {warnings.map((w, i) => (
                        <li key={i} className="font-mono text-xs">
                          {w}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          ) : null}

          {(deploying || logs.length > 0) ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Deploy log
                </div>
                <Badge
                  variant={deployDone ? "default" : deployError ? "destructive" : "secondary"}
                  className="font-mono text-[10px]"
                >
                  {phase}
                </Badge>
              </div>
              <div
                ref={logRef}
                className={cn(
                  "rounded-md bg-zinc-950 text-zinc-100 p-3 font-mono text-[11px] leading-relaxed overflow-auto max-h-[40vh] min-h-[160px]",
                  deployDone && "border border-emerald-500/40",
                  deployError && "border border-red-500/40"
                )}
              >
                {logs.length === 0 ? (
                  <span className="text-zinc-500">
                    <Loader2 className="size-3 animate-spin inline mr-1" />
                    Starting deploy…
                  </span>
                ) : null}
                {logs.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap">
                    {l}
                  </div>
                ))}
                {deployError ? (
                  <div className="text-red-400 mt-2">{deployError}</div>
                ) : null}
                {deployDone ? (
                  <div className="text-emerald-400 mt-2">
                    ✓ stack {name.trim()} deployed
                  </div>
                ) : null}
              </div>

              {serviceStatuses.length > 0 ? (
                <div className="grid sm:grid-cols-2 gap-2 pt-1">
                  {serviceStatuses.map((s) => (
                    <div
                      key={s.service}
                      className="flex items-center justify-between rounded-md border border-border/60 px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono">{s.service}</span>
                      <Badge
                        variant={
                          s.status === "running"
                            ? "default"
                            : s.status === "creating"
                              ? "secondary"
                              : "outline"
                        }
                        className="font-mono text-[10px]"
                      >
                        {s.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </WorkspacePage>
  );
}
