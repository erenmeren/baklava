import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { LoadTestResult } from "@/lib/loadtest/results";

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-muted-foreground mt-0.5">{sub}</div> : null}
    </Card>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ResultDashboard({ result }: { result: LoadTestResult }) {
  const errorPct = `${(result.errorRate * 100).toFixed(2)}%`;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        <Metric label="Requests" value={String(result.totalRequests)} />
        <Metric label="RPS" value={result.rps.toFixed(1)} />
        <Metric label="Error rate" value={errorPct} />
        <Metric label="Max VUs" value={String(result.vusMax)} />
        <Metric label="p50" value={`${result.latency.p50}ms`} />
        <Metric label="p95" value={`${result.latency.p95}ms`} />
        <Metric label="p99" value={`${result.latency.p99}ms`} />
        <Metric label="Max" value={`${result.latency.max}ms`} />
      </div>

      <div className="text-xs text-muted-foreground">
        Data sent {fmtBytes(result.dataSent)} · received {fmtBytes(result.dataReceived)}
      </div>

      {result.requests.length ? (
        <div>
          <h3 className="text-sm font-semibold mb-2">Per request</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">p95</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.requests.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-mono text-xs">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.latency.p95 != null ? `${r.latency.p95}ms` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {result.thresholds.length ? (
        <div>
          <h3 className="text-sm font-semibold mb-2">Thresholds</h3>
          <ul className="space-y-1">
            {result.thresholds.map((t) => (
              <li key={t.name} className="flex items-center gap-2 text-sm">
                <span className={cn("font-mono text-xs", t.passed ? "text-emerald-600" : "text-destructive")}>
                  {t.passed ? "PASS" : "FAIL"}
                </span>
                <span className="text-muted-foreground">{t.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
