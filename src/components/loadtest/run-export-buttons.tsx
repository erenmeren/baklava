"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import { FileText, Braces, Sheet } from "lucide-react";
import { downloadText } from "@/lib/sql/result-export";
import { runToCsv, runToJson, exportFilename } from "@/lib/loadtest/run-export";
import type { LoadTestRun } from "@/lib/loadtest/store";

export function RunExportButtons({
  testId,
  testName,
  run,
}: {
  testId: string;
  testName: string;
  run: LoadTestRun;
}) {
  const stem = exportFilename(testName, run.id);
  const hasResult = !!run.result;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`/api/loadtest/${testId}/runs/${run.id}/pdf`}
        className={buttonVariants({ size: "sm", variant: "default" })}
      >
        <FileText className="size-3.5" />
        PDF report
      </a>
      <Button
        size="sm"
        variant="outline"
        onClick={() => downloadText(`${stem}.json`, runToJson(testName, run), "application/json")}
      >
        <Braces className="size-3.5" />
        JSON
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!hasResult}
        onClick={() => downloadText(`${stem}.csv`, runToCsv(run), "text/csv")}
      >
        <Sheet className="size-3.5" />
        CSV
      </Button>
    </div>
  );
}
