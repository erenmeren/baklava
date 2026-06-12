"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Play } from "lucide-react";
import { ResultDashboard } from "@/components/loadtest/result-dashboard";
import { RunProgress } from "@/components/loadtest/run-progress";
import { parseK6Progress } from "@/lib/loadtest/progress-parser";
import type { LoadTestResult } from "@/lib/loadtest/results";
import type { PublicLoadTest, LoadTestRun } from "@/lib/loadtest/store";
import { SseFrameParser } from "./sse";

export function RunClient({ testId }: { testId: string }) {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [vus, setVus] = useState<number | undefined>();
  const [iterations, setIterations] = useState<number | undefined>();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<LoadTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasRunRef = useRef(false);
  const startRef = useRef(0);

  // Load the latest run's result when idle.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const tRes = await fetch(`/api/loadtest/${testId}`, { cache: "no-store" });
        const tData = await tRes.json();
        const last = (tData.loadtest as PublicLoadTest | undefined)?.lastRun;
        if (!last) return;
        const rRes = await fetch(`/api/loadtest/${testId}/runs/${last.id}`, { cache: "no-store" });
        const rData = await rRes.json();
        if (active && !hasRunRef.current && rRes.ok) setResult((rData.run as LoadTestRun).result ?? null);
      } catch {
        /* ignore */
      }
    })();
    return () => { active = false; };
  }, [testId]);

  // elapsed timer
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 200);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    hasRunRef.current = true;
    setRunning(true);
    setLines([]);
    setVus(undefined);
    setIterations(undefined);
    setResult(null);
    setError(null);
    startRef.current = Date.now();
    setElapsedMs(0);
    const ac = new AbortController();
    abortRef.current = ac;
    const parser = new SseFrameParser();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const res = await fetch(`/api/loadtest/${testId}/run`, { method: "POST", signal: ac.signal });
      if (!res.body) throw new Error("no response stream");
      reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          if (frame.event === "progress") {
            const line = (frame.data as { line: string }).line;
            setLines((l) => [...l, line]);
            const parsed = parseK6Progress(line);
            if (parsed.vus != null) setVus(parsed.vus);
            if (parsed.iterations != null) setIterations(parsed.iterations);
          } else if (frame.event === "result") {
            setResult(frame.data as LoadTestResult);
          } else if (frame.event === "error") {
            setError((frame.data as { message: string }).message);
          }
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      reader?.cancel().catch(() => undefined);
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  return (
    <WorkspacePage
      title="Run"
      description="Execute this load test and watch live progress."
      actions={!running ? <Button onClick={run}><Play className="size-4" />Run test</Button> : null}
    >
      <div className="space-y-5">
        {running ? <RunProgress elapsedMs={elapsedMs} vus={vus} iterations={iterations} lines={lines} onCancel={cancel} /> : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Run failed</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
          </Alert>
        ) : null}
        {result ? <ResultDashboard result={result} /> : !running && !error ? (
          <p className="text-sm text-muted-foreground">No results yet — click <span className="font-medium text-foreground">Run test</span>.</p>
        ) : null}
      </div>
    </WorkspacePage>
  );
}
