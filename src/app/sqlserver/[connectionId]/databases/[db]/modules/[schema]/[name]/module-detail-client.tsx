"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { ArrowLeft, Copy, Loader2, Play } from "lucide-react";

interface Param {
  name: string;
  type: string;
  isOutput: boolean;
  hasDefault: boolean;
}
interface Module {
  schema: string;
  name: string;
  kind: string;
  definition: string | null;
  params: Param[];
}
interface ResultSet {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
}

interface Props {
  connectionId: string;
  database: string;
  schema: string;
  name: string;
}

const KIND_LABEL: Record<string, string> = {
  proc: "stored procedure",
  scalar_fn: "scalar function",
  table_fn: "table-valued function",
  trigger: "trigger",
  view: "view",
};

export function ModuleDetailClient({ connectionId, database, schema, name }: Props) {
  const [module, setModule] = useState<Module | null>(null);
  const [tab, setTab] = useState("body");
  const [args, setArgs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ResultSet[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/modules/${encodeURIComponent(schema)}/${encodeURIComponent(name)}`,
        { cache: "no-store" },
      );
      const d = await res.json();
      if (res.ok) setModule(d as Module);
      else toast.error("Could not load object", { description: d.error });
    })();
  }, [connectionId, database, schema, name]);

  const execProc = useCallback(async () => {
    if (!module) return;
    setRunning(true);
    setResults(null);
    // Build EXEC with @param = value. Values go through the editor endpoint
    // which runs them as a batch — quote string-ish values, pass numbers raw.
    const argList = module.params
      .filter((p) => !p.isOutput)
      .map((p) => {
        const v = args[p.name] ?? "";
        if (v === "" && p.hasDefault) return null; // let default apply
        const numeric = /^-?\d+(\.\d+)?$/.test(v);
        const lit = numeric || v.toUpperCase() === "NULL" ? v : `'${v.replace(/'/g, "''")}'`;
        return `${p.name} = ${lit}`;
      })
      .filter(Boolean)
      .join(", ");
    const sql =
      module.kind === "proc"
        ? `EXEC [${schema}].[${name}] ${argList}`
        : `SELECT * FROM [${schema}].[${name}](${module.params
            .filter((p) => !p.isOutput)
            .map((p) => {
              const v = args[p.name] ?? "";
              const numeric = /^-?\d+(\.\d+)?$/.test(v);
              return numeric || v.toUpperCase() === "NULL" ? v : `'${v.replace(/'/g, "''")}'`;
            })
            .join(", ")})`;
    try {
      const res = await fetch(`/api/sqlserver/${connectionId}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql, database }),
      });
      const d = await res.json();
      if (d.error && !d.batches) {
        toast.error("Execution failed", { description: d.error });
        return;
      }
      const batch = d.batches?.[0];
      if (batch?.error) {
        toast.error("Execution failed", { description: batch.error });
        return;
      }
      setResults(batch?.resultSets ?? []);
      toast.success("Executed");
    } finally {
      setRunning(false);
    }
  }, [module, args, connectionId, database, schema, name]);

  return (
    <WorkspacePage
      title={<span className="font-mono">{schema}.{name}</span>}
      description={module ? KIND_LABEL[module.kind] ?? module.kind : `database ${database}`}
      actions={
        <Link
          href={`/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Link>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="body">Definition</TabsTrigger>
          <TabsTrigger value="params">
            Parameters {module ? `(${module.params.length})` : ""}
          </TabsTrigger>
          {module && (module.kind === "proc" || module.kind === "table_fn") ? (
            <TabsTrigger value="execute">Execute</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="body" className="pt-4">
          {!module ? (
            <Skeleton className="h-60 w-full" />
          ) : (
            <div className="relative">
              <Button
                size="xs"
                variant="outline"
                className="absolute top-2 right-2 gap-1"
                onClick={async () => {
                  await navigator.clipboard.writeText(module.definition ?? "");
                  toast.success("Copied");
                }}
              >
                <Copy className="size-3" /> copy
              </Button>
              <pre className="rounded-md border border-border/60 bg-zinc-950 text-zinc-100 p-4 text-xs font-mono whitespace-pre-wrap break-words overflow-auto max-h-[60vh]">
                {module.definition ?? "(definition unavailable — encrypted or insufficient permissions)"}
              </pre>
            </div>
          )}
        </TabsContent>

        <TabsContent value="params" className="pt-4">
          {!module ? (
            <Skeleton className="h-40 w-full" />
          ) : module.params.length === 0 ? (
            <p className="text-sm text-muted-foreground">No parameters.</p>
          ) : (
            <div className="space-y-1.5">
              {module.params.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-3 text-sm font-mono rounded-md border border-border/40 bg-card/40 px-3 py-1.5"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{p.type}</span>
                  {p.isOutput ? <Badge variant="secondary">OUTPUT</Badge> : null}
                  {p.hasDefault ? <Badge variant="secondary">has default</Badge> : null}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="execute" className="pt-4 space-y-4">
          {!module ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="space-y-2 max-w-lg">
                {module.params
                  .filter((p) => !p.isOutput)
                  .map((p) => (
                    <div key={p.name} className="space-y-1">
                      <Label className="text-xs font-mono">
                        {p.name}{" "}
                        <span className="text-muted-foreground">{p.type}</span>
                        {p.hasDefault ? (
                          <span className="text-muted-foreground/60"> · optional</span>
                        ) : null}
                      </Label>
                      <Input
                        value={args[p.name] ?? ""}
                        onChange={(e) =>
                          setArgs((a) => ({ ...a, [p.name]: e.target.value }))
                        }
                        placeholder={p.hasDefault ? "(default)" : ""}
                        className="h-8 font-mono"
                      />
                    </div>
                  ))}
              </div>
              <Button onClick={execProc} disabled={running} className="gap-1.5">
                {running ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Execute
              </Button>
              {results
                ? results.map((rs, ri) => (
                    <div
                      key={ri}
                      className="rounded-lg border border-border/60 overflow-auto"
                    >
                      <table className="w-full text-xs font-mono">
                        <thead className="bg-muted/40">
                          <tr>
                            {rs.fields.map((f, i) => (
                              <th key={i} className="px-3 py-1.5 text-left font-semibold">
                                {f}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rs.rows.map((row, r) => (
                            <tr key={r} className="border-t border-border/30">
                              {row.map((c, ci) => (
                                <td key={ci} className="px-3 py-1 align-top">
                                  {c === null || c === undefined ? (
                                    <span className="text-muted-foreground/40">NULL</span>
                                  ) : (
                                    String(c)
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))
                : null}
            </>
          )}
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  );
}
