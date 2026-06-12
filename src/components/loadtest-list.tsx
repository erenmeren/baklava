"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/loadtest/status-pill";
import type { PublicLoadTest } from "@/lib/loadtest/store";

export function LoadTestList({ refreshKey, onEdit }: { refreshKey: number; onEdit: (t: PublicLoadTest) => void }) {
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
    return () => { active = false; };
  }, [refreshKey]);

  const remove = async (id: string) => {
    const res = await fetch(`/api/loadtest/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTests((t) => t.filter((x) => x.id !== id));
      toast.success("Test deleted");
    } else {
      toast.error("Delete failed");
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!tests.length) return <p className="text-sm text-muted-foreground">No saved tests yet — click <span className="font-medium text-foreground">New test</span> to add one.</p>;

  return (
    <div className="space-y-2">
      {tests.map((t) => (
        <Card key={t.id} className="p-3 flex items-center gap-3">
          <Link href={`/loadtest/${t.id}/run`} className="min-w-0 flex-1">
            <div className="font-medium text-sm truncate">{t.name}</div>
            <div className="text-xs text-muted-foreground truncate">{t.config.target.baseUrl}</div>
          </Link>
          {t.lastRun ? <StatusPill status={t.lastRun.status} /> : <span className="text-xs text-muted-foreground">no runs</span>}
          <Button size="sm" variant="ghost" onClick={() => onEdit(t)}>Edit</Button>
          <Button size="icon" variant="ghost" onClick={() => remove(t.id)} aria-label="Delete test"><Trash2 className="size-3.5" /></Button>
        </Card>
      ))}
    </div>
  );
}
