"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Sparkline } from "@/components/workspace/sparkline";
import {
  appendSamples,
  HISTORY_SIZE,
  historyMinutes,
  parseFormattedCpu,
  parseFormattedMemory,
  type History,
} from "@/lib/kubernetes/usage-history";

/** The shell's router.refresh cadence — one sample per server render. */
const SAMPLE_MS = 5_000;

interface UsageRow {
  name: string;
  namespace?: string;
  cpuUsage?: string | null;
  memUsage?: string | null;
}

interface UsageHistoryValue {
  history: History;
  minutes: number;
}

const Ctx = createContext<UsageHistoryValue | null>(null);
export const UsageHistoryProvider = Ctx.Provider;

const keyOf = (r: UsageRow) => `${r.namespace ?? ""}/${r.name}`;

/**
 * Sample each row's usage every time the server list arrives (the periodic
 * refresh carries fresh metrics-server numbers; watch upserts don't).
 */
export function useUsageHistory(rows: UsageRow[]): UsageHistoryValue {
  const [history, setHistory] = useState<History>({});
  const [samples, setSamples] = useState(0);
  useEffect(() => {
    const next: Record<string, number | null> = {};
    for (const r of rows) {
      next[`${keyOf(r)}:cpu`] = parseFormattedCpu(r.cpuUsage);
      next[`${keyOf(r)}:mem`] = parseFormattedMemory(r.memUsage);
    }
    setHistory((h) => appendSamples(h, next));
    setSamples((n) => Math.min(n + 1, HISTORY_SIZE));
  }, [rows]);
  return useMemo(() => ({ history, minutes: historyMinutes(samples, SAMPLE_MS) }), [history, samples]);
}

/** Usage value with a tiny sparkline of its session history. */
export function UsageCell({ row, metric }: { row: UsageRow; metric: "cpu" | "mem" }) {
  const ctx = useContext(Ctx);
  const values = ctx?.history[`${keyOf(row)}:${metric}`] ?? [];
  const value = metric === "cpu" ? row.cpuUsage : row.memUsage;
  return (
    // The sparkline sits in the cell's free left gutter so the column keeps its
    // width (a wider usage column squeezes the flex `name` column further).
    <span
      className="relative inline-flex w-full items-center justify-end"
      title={`${metric} · last ${ctx?.minutes ?? 1}m · live, lost on refresh`}
    >
      {value && values.length > 1 ? (
        <Sparkline
          values={values}
          width={24}
          height={12}
          className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-cyan-500/60"
          ariaLabel={`${metric} history`}
        />
      ) : null}
      <span className="relative text-cyan-600 dark:text-cyan-400 tabular-nums">{value ?? "—"}</span>
    </span>
  );
}
