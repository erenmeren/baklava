"use client";

import { useEffect, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { LoadTestForm } from "@/app/loadtest/loadtest-form";
import type { PublicLoadTest } from "@/lib/loadtest/store";

export function ConfigClient({ testId }: { testId: string }) {
  const [test, setTest] = useState<PublicLoadTest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/loadtest/${testId}`, { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (res.ok) setTest(data.loadtest as PublicLoadTest);
        else setError(data.error || "Failed to load test");
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { active = false; };
  }, [testId]);

  return (
    <WorkspacePage title="Configuration" description="Edit this load test's target, requests, auth, profile and thresholds.">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {test ? <LoadTestForm initial={test} /> : !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
    </WorkspacePage>
  );
}
