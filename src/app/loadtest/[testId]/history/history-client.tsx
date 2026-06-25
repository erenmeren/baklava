"use client";

import { useEffect, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/workspace/sparkline";
import { RelativeTime } from "@/components/workspace/relative-time";
import { StatusPill } from "@/components/loadtest/status-pill";
import { ResultDashboard } from "@/components/loadtest/result-dashboard";
import { RunExportButtons } from "@/components/loadtest/run-export-buttons";
import type { RunSummary, LoadTestRun } from "@/lib/loadtest/store";

export function HistoryClient({ testId, testName }: { testId: string; testName: string }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LoadTestRun | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/loadtest/${testId}/runs`, { cache: "no-store" });
        const data = await res.json();
        if (active) setRuns((data.runs as RunSummary[]) ?? []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [testId]);

  const openRun = async (runId: string) => {
    const res = await fetch(`/api/loadtest/${testId}/runs/${runId}`, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setSelected(data.run as LoadTestRun);
  };

  // p95 trend, oldest→newest (runs come newest-first); include 0-values, exclude no-result runs
  const trend = [...runs].reverse().filter((r) => r.p95 != null).map((r) => r.p95 as number);

  return (
    <WorkspacePage title="History" description="Past runs of this load test.">
      <div className="space-y-5">
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {!loading && !runs.length ? <p className="text-sm text-muted-foreground">No runs yet.</p> : null}

        {trend.length >= 2 ? (
          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">p95 trend</div>
            <Sparkline values={trend} width={480} height={40} className="w-full" />
          </Card>
        ) : null}

        <div className="space-y-2">
          {runs.map((r) => (
            <button key={r.id} type="button" onClick={() => openRun(r.id)} className="w-full text-left">
              <Card className="p-3 flex items-center gap-3 hover:border-border/80">
                <StatusPill status={r.status} />
                <span className="text-xs text-muted-foreground"><RelativeTime value={r.startedAt} /></span>
                <div className="flex-1" />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {r.p95 != null ? `p95 ${r.p95}ms` : "—"} · {r.rps != null ? `${r.rps.toFixed(1)} rps` : "—"} · {r.errorRate != null ? `${(r.errorRate * 100).toFixed(1)}%` : "—"}
                </span>
              </Card>
            </button>
          ))}
        </div>

        {selected ? (
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-sm font-semibold">Run detail</h3>
              <RunExportButtons testId={testId} testName={testName} run={selected} />
            </div>
            {selected.result ? (
              <ResultDashboard result={selected.result} />
            ) : selected.status === "error" ? (
              <p className="text-sm text-destructive whitespace-pre-wrap">{selected.error ?? "Run failed with no result."}</p>
            ) : (
              <p className="text-sm text-muted-foreground">This run produced no results ({selected.status}).</p>
            )}
          </div>
        ) : null}
      </div>
    </WorkspacePage>
  );
}
