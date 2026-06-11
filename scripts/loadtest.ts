import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runLoadTest } from "@/lib/loadtest";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run loadtest -- <config.json>");
    process.exit(2);
  }

  const raw = readFileSync(resolve(process.cwd(), file), "utf8");
  const config = JSON.parse(raw);

  console.error(`\n▶ Running load test: ${config.name ?? "loadtest"}\n`);

  const result = await runLoadTest(config, {
    onProgress: ({ line }) => process.stderr.write(`  ${line}\n`),
  });

  console.log("\n──────── Results ────────");
  console.log(`Requests:   ${result.totalRequests}  (${result.rps.toFixed(1)} req/s)`);
  console.log(`Errors:     ${(result.errorRate * 100).toFixed(2)}%`);
  console.log(
    `Latency:    p50 ${result.latency.p50}ms  p95 ${result.latency.p95}ms  p99 ${result.latency.p99}ms  max ${result.latency.max}ms`,
  );
  console.log(`Max VUs:    ${result.vusMax}`);
  console.log(`Data:       up ${fmtBytes(result.dataSent)}  down ${fmtBytes(result.dataReceived)}`);

  if (result.requests.length > 1) {
    console.log("\nPer request (p95):");
    for (const r of result.requests) {
      console.log(`  ${r.name}: ${r.latency.p95 ?? "-"}ms`);
    }
  }

  if (result.thresholds.length) {
    console.log("\nThresholds:");
    for (const t of result.thresholds) {
      console.log(`  ${t.passed ? "PASS" : "FAIL"} ${t.name}`);
    }
  }

  console.log(`\n${result.passed ? "PASSED" : "FAILED"}\n`);
  process.exit(result.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
