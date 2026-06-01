"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, ExternalLink } from "lucide-react";
import type { TechId } from "@/lib/connections/types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";

interface Props {
  tech: TechId;
  connectionId: string;
  bucket: string;
}

function JsonRuleEditor({
  label,
  endpoint,
  help,
}: {
  label: string;
  endpoint: string;
  help: string;
}) {
  const [text, setText] = useState("[]");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setText(JSON.stringify(data.rules ?? [], null, 2));
      else toast.error(`Load ${label} failed`, { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [endpoint, label]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    let rules: unknown;
    try {
      rules = JSON.parse(text);
    } catch {
      toast.error("Invalid JSON");
      return;
    }
    if (!Array.isArray(rules)) {
      toast.error("Expected a JSON array of rules");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      const data = await res.json();
      if (res.ok) toast.success(`${label} saved`);
      else toast.error(`Save ${label} failed`, { description: data.error });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <Button size="sm" onClick={save} disabled={loading || saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{help}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={10}
        className="w-full font-mono text-xs rounded-md border bg-background p-2 resize-y"
        disabled={loading}
      />
    </section>
  );
}

export function BucketSettings({ tech, connectionId, bucket }: Props) {
  const base = `/api/${tech}/${connectionId}/buckets/${encodeURIComponent(bucket)}`;
  return (
    <div className="space-y-8 max-w-3xl py-2">
      <JsonRuleEditor
        label="CORS rules"
        endpoint={`${base}/cors`}
        help="Array of S3 CORSRule objects (AllowedOrigins, AllowedMethods, AllowedHeaders, …)."
      />
      <JsonRuleEditor
        label="Lifecycle rules"
        endpoint={`${base}/lifecycle`}
        help="Array of S3 LifecycleRule objects (ID, Filter, Expiration, …). R2 supports a subset."
      />
      <Alert>
        <AlertTitle className="flex items-center gap-1.5">
          Public access
        </AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            R2 public access (the r2.dev domain and custom domains) is managed
            through the Cloudflare dashboard, not the S3 API, so it can&apos;t be
            toggled here.
          </p>
          <a
            href="https://dash.cloudflare.com/?to=/:account/r2/default/buckets"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-foreground underline"
          >
            Open in Cloudflare dashboard <ExternalLink className="size-3" />
          </a>
        </AlertDescription>
      </Alert>
    </div>
  );
}
