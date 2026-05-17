"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, PlugZap, Save, ShieldAlert } from "lucide-react";
import type {
  ConnectionRecord,
  SupabaseConfig,
} from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

function deriveRef(url: string): string {
  try {
    const host = new URL(url).hostname;
    const [ref] = host.split(".");
    return ref || "";
  } catch {
    return "";
  }
}

export function SupabaseForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as SupabaseConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(init?.url ?? "");
  const [serviceRoleKey, setServiceRoleKey] = useState("");
  // databaseUrl may embed a Postgres password — treat as a secret.
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [showDbUrl, setShowDbUrl] = useState(Boolean(init?.databaseUrl));

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeUsers, setProbeUsers] = useState<number | null>(null);

  const urlValid = useMemo(() => {
    if (!url.trim()) return false;
    try {
      const u = new URL(url.trim());
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, [url]);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = { url: url.trim() };
    if (serviceRoleKey.trim()) cfg.serviceRoleKey = serviceRoleKey.trim();
    else if (!editing) cfg.serviceRoleKey = "";
    // databaseUrl: omit when blank-and-editing so the existing one is kept.
    if (databaseUrl.trim()) cfg.databaseUrl = databaseUrl.trim();
    else if (!editing) cfg.databaseUrl = undefined;
    return cfg;
  };

  const resolvedName = name.trim() || deriveRef(url) || "Supabase";

  const test = async (save: boolean) => {
    if (!urlValid) {
      setError("Project URL must be a valid URL");
      return;
    }
    if (!editing && !serviceRoleKey.trim()) {
      setError("Service role key is required");
      return;
    }
    setTesting(true);
    setError(null);
    setProbeUsers(null);
    try {
      if (save && editing && initial) {
        const res = await fetch(`/api/connections/${initial.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: resolvedName, config: buildConfig() }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success("Connection updated");
          onSaved?.();
        } else {
          setError(data.error || "Update failed");
          toast.error("Update failed", { description: data.error });
        }
        return;
      }
      const res = await fetch("/api/supabase/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: resolvedName, config: buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setProbeUsers(data.probe.totalUsers);
        if (save) {
          toast.success("Connection saved");
          onSaved?.();
        } else {
          toast.success("Connection works", {
            description:
              data.probe.totalUsers != null
                ? `${data.probe.totalUsers} auth user${data.probe.totalUsers === 1 ? "" : "s"}`
                : "Service role key accepted",
          });
        }
      } else {
        setError(data.error || "Connection failed");
        toast.error("Connection failed", { description: data.error });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Request failed", { description: msg });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">
          {editing ? "Edit connection" : "New connection"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Connect to a Supabase project using its service role key.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="supabase-name">Name</Label>
          <Input
            id="supabase-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={deriveRef(url) || "My Supabase project"}
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="supabase-ref">Project ref</Label>
          <Input
            id="supabase-ref"
            value={deriveRef(url)}
            readOnly
            disabled
            className="font-mono text-xs"
            placeholder="abcdefgh"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="supabase-url">Project URL</Label>
        <Input
          id="supabase-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://abcdefgh.supabase.co"
          spellCheck={false}
          aria-invalid={url.length > 0 && !urlValid}
        />
      </div>

      <div className="space-y-2">
        <Alert>
          <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle>service_role bypasses RLS</AlertTitle>
          <AlertDescription>
            Don&apos;t share this key. It stays in your local connections file
            only.
          </AlertDescription>
        </Alert>
        <Label htmlFor="supabase-key">service_role key</Label>
        <Textarea
          id="supabase-key"
          value={serviceRoleKey}
          onChange={(e) => setServiceRoleKey(e.target.value)}
          placeholder={
            editing
              ? "(unchanged — leave blank to keep)"
              : "eyJhbGciOi..."
          }
          spellCheck={false}
          className="font-mono text-xs min-h-[88px]"
        />
      </div>

      <div className="rounded-lg border border-border/60">
        <button
          type="button"
          onClick={() => setShowDbUrl((v) => !v)}
          className="w-full px-3 py-2 flex items-center justify-between text-sm hover:bg-muted/30 rounded-lg"
        >
          <span className="inline-flex items-center gap-2">
            {showDbUrl ? (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 text-muted-foreground" />
            )}
            Database URL <span className="text-muted-foreground text-xs">(optional)</span>
          </span>
          {databaseUrl ? (
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              set
            </span>
          ) : null}
        </button>
        {showDbUrl ? (
          <div className="px-3 pb-3 space-y-2">
            <Input
              id="supabase-dburl"
              value={databaseUrl}
              onChange={(e) => setDatabaseUrl(e.target.value)}
              placeholder={
                editing && init?.databaseUrl
                  ? "(unchanged — leave blank to keep)"
                  : "postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
              }
              spellCheck={false}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Enables future SQL passthrough. Not used yet.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={() => test(false)} disabled={testing} variant="outline">
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlugZap className="size-4" />
          )}
          Test
        </Button>
        <Button onClick={() => test(true)} disabled={testing}>
          {editing ? <Save className="size-4" /> : null}
          {editing ? "Save changes" : "Test & save"}
        </Button>
      </div>

      {probeUsers !== null ? (
        <Alert>
          <AlertTitle>Project reachable</AlertTitle>
          <AlertDescription>
            {probeUsers != null
              ? `${probeUsers} auth user${probeUsers === 1 ? "" : "s"} on this project.`
              : "Service role key accepted."}
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not connect</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      ) : null}
    </Card>
  );
}
