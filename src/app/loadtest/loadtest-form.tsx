"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, Plus, Save } from "lucide-react";
import type { PublicLoadTest } from "@/lib/loadtest/store";
import {
  buildSavedConfig,
  emptyFormState,
  emptyRequest,
  toFormState,
  validateFormState,
  type FormState,
  type RequestForm,
} from "./form-serialize";
import { HeaderRows, AuthFields } from "./auth-fields";
import { ProfileFields } from "./profile-fields";
import { RequestCard } from "./request-card";

export function LoadTestForm({ initial, onSaved }: { initial?: PublicLoadTest; onSaved?: () => void }) {
  const editing = Boolean(initial);
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => (initial ? toFormState(initial) : emptyFormState()));
  const [expanded, setExpanded] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchRequest = (i: number, patch: Partial<RequestForm>) =>
    setState((s) => ({ ...s, requests: s.requests.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const moveRequest = (i: number, dir: -1 | 1) =>
    setState((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.requests.length) return s;
      const next = [...s.requests];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...s, requests: next };
    });

  const save = async () => {
    const validationError = validateFormState(state);
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError(null);
    try {
      const config = buildSavedConfig(state);
      const res = editing
        ? await fetch(`/api/loadtest/${initial!.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: state.name, config }),
          })
        : await fetch("/api/loadtest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: state.name, config }),
          });
      const data = await res.json();
      if (res.ok) {
        toast.success(editing ? "Test updated" : "Test created");
        onSaved?.();
        if (!editing && data.loadtest?.id) router.push(`/loadtest/${data.loadtest.id}/run`);
      } else {
        setError(data.error || "Save failed");
        toast.error("Save failed", { description: typeof data.error === "string" ? data.error : undefined });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Request failed", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <Card className="p-5 space-y-4">
            <div className="space-y-1">
              <Label>Test name</Label>
              <Input value={state.name} onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))} placeholder="Checkout flow" />
            </div>
            <div className="space-y-1">
              <Label>Base URL</Label>
              <Input value={state.target.baseUrl} onChange={(e) => setState((s) => ({ ...s, target: { ...s.target, baseUrl: e.target.value } }))} placeholder="https://api.example.com" />
              <p className="text-xs text-muted-foreground">
                Include the scheme (defaults to <code>http://</code> if omitted). A local server like{" "}
                <code>localhost:3000</code> works — it&apos;s reached via the Docker host gateway.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Default headers</Label>
              <HeaderRows rows={state.target.headers} onChange={(headers) => setState((s) => ({ ...s, target: { ...s.target, headers } }))} />
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Requests</h3>
              <Button type="button" size="sm" variant="outline" onClick={() => setState((s) => ({ ...s, requests: [...s.requests, emptyRequest()] }))}>
                <Plus className="size-3.5" />
                Add request
              </Button>
            </div>
            <div className="space-y-2">
              {state.requests.map((req, i) => (
                <RequestCard
                  key={i}
                  req={req}
                  index={i}
                  expanded={expanded === i}
                  onToggle={() => setExpanded((cur) => (cur === i ? -1 : i))}
                  onChange={(patch) => patchRequest(i, patch)}
                  onRemove={() => setState((s) => ({ ...s, requests: s.requests.filter((_, idx) => idx !== i) }))}
                  onMove={(dir) => moveRequest(i, dir)}
                  canRemove={state.requests.length > 1}
                />
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-5"><AuthFields auth={state.auth} editing={editing} onChange={(auth) => setState((s) => ({ ...s, auth }))} /></Card>

          <Card className="p-5"><ProfileFields profile={state.profile} onChange={(profile) => setState((s) => ({ ...s, profile }))} /></Card>

          <Card className="p-5 space-y-3">
            <h3 className="font-semibold text-sm">Thresholds (optional)</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>p95 (ms)</Label><Input value={state.thresholds.p95} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, p95: e.target.value } }))} /></div>
              <div className="space-y-1"><Label>p99 (ms)</Label><Input value={state.thresholds.p99} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, p99: e.target.value } }))} /></div>
              <div className="space-y-1"><Label>Error rate (0–1)</Label><Input value={state.thresholds.errorRate} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, errorRate: e.target.value } }))} placeholder="0.01" /></div>
              <div className="space-y-1"><Label>Min RPS</Label><Input value={state.thresholds.minRps} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, minRps: e.target.value } }))} /></div>
            </div>
          </Card>

          <Button onClick={save} disabled={saving} className="w-full">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {editing ? "Save changes" : "Create test"}
          </Button>
        </div>
      </div>
    </div>
  );
}
