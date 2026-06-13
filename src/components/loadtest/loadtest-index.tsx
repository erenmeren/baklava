"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Plus, Trash2, Play, Pencil } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/loadtest/status-pill";
import type { PublicLoadTest } from "@/lib/loadtest/store";

function methodMix(t: PublicLoadTest): string {
  const counts: Record<string, number> = {};
  for (const r of t.config.requests) counts[r.method] = (counts[r.method] ?? 0) + 1;
  return Object.entries(counts)
    .map(([m, n]) => (n > 1 ? `${m}·${n}` : m))
    .join("  ");
}

export function LoadTestIndex() {
  const [tests, setTests] = useState<PublicLoadTest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/loadtest", { cache: "no-store" });
        const data = (await res.json()) as { loadtests: PublicLoadTest[] };
        if (active) setTests(data.loadtests ?? []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const remove = async (id: string) => {
    const res = await fetch(`/api/loadtest/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTests((t) => t.filter((x) => x.id !== id));
      toast.success("Test deleted");
    } else {
      toast.error("Delete failed");
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 pt-6 pb-12 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Load Testing</h1>
          <p className="text-sm text-muted-foreground">
            Define and run k6 load tests against any REST API.
          </p>
        </div>
        <Link href="/loadtest/new" className={buttonVariants({ size: "sm" })}>
          <Plus className="size-3.5" />
          New test
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tests.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No saved tests yet —{" "}
          <span className="font-medium text-foreground">New test</span> to add one.
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tests.map((t) => (
            <Card key={t.id} className="p-4 flex flex-col gap-3">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{t.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {t.config.target.baseUrl}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-muted-foreground truncate">
                  {methodMix(t)}
                </span>
                {t.lastRun ? (
                  <StatusPill status={t.lastRun.status} />
                ) : (
                  <span className="text-[11px] text-muted-foreground">no runs</span>
                )}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Link
                  href={`/loadtest/${t.id}/run`}
                  className={buttonVariants({
                    size: "sm",
                    variant: "default",
                    className: "flex-1",
                  })}
                >
                  <Play className="size-3.5" />
                  Run
                </Link>
                <Link
                  href={`/loadtest/${t.id}/config`}
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                  aria-label="Edit test"
                >
                  <Pencil className="size-3.5" />
                </Link>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => remove(t.id)}
                  aria-label="Delete test"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
