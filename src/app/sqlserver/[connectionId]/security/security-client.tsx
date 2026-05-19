"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { AlertTriangle, RefreshCcw, Server, Users } from "lucide-react";

interface Login {
  name: string;
  type: string;
  isDisabled: boolean;
  serverRoles: string[];
}
interface User {
  name: string;
  type: string;
  defaultSchema: string | null;
  databaseRoles: string[];
  orphaned: boolean;
}
interface Payload {
  database: string;
  logins: Login[];
  users: User[];
}

export function SecurityClient({
  connectionId,
  defaultDatabase,
}: {
  connectionId: string;
  defaultDatabase: string;
}) {
  const [database, setDatabase] = useState(defaultDatabase);
  const [databases, setDatabases] = useState<string[]>([defaultDatabase]);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetch(`/api/sqlserver/${connectionId}/databases`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return;
        const d = await r.json();
        if (d.databases) setDatabases(d.databases.map((x: { name: string }) => x.name));
      })
      .catch(() => {});
  }, [connectionId]);

  const load = useCallback(async () => {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/security?db=${encodeURIComponent(database)}`,
        { cache: "no-store" },
      );
      const d = await res.json();
      if (res.ok) setData(d as Payload);
      else toast.error("Could not load security", { description: d.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  useEffect(() => {
    void load();
  }, [load]);

  const orphans = data?.users.filter((u) => u.orphaned).length ?? 0;

  return (
    <WorkspacePage
      title="Security"
      description="Server-level logins vs database-level users — SQL Server's two-tier model. Orphaned users (no matching login) are flagged."
      actions={
        <div className="flex items-center gap-2">
          <Select value={database} onValueChange={(v) => v && setDatabase(v)}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {databases.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCcw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            Refresh
          </Button>
        </div>
      }
    >
      {!data ? (
        <Skeleton className="h-60 w-full" />
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Server logins */}
          <section>
            <h2 className="text-xs uppercase tracking-wider font-mono text-muted-foreground mb-2 inline-flex items-center gap-1.5">
              <Server className="size-3.5" />
              Server logins ({data.logins.length})
            </h2>
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Login</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Server roles</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.logins.map((l) => (
                    <TableRow key={l.name} className={l.isDisabled ? "opacity-50" : ""}>
                      <TableCell className="font-mono text-xs">
                        {l.name}
                        {l.isDisabled ? (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">disabled</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {l.type.replace("_LOGIN", "")}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {l.serverRoles.join(", ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {/* Database users */}
          <section>
            <h2 className="text-xs uppercase tracking-wider font-mono text-muted-foreground mb-2 inline-flex items-center gap-1.5">
              <Users className="size-3.5" />
              Users in {data.database} ({data.users.length})
              {orphans > 0 ? (
                <span className="inline-flex items-center gap-1 text-amber-600">
                  <AlertTriangle className="size-3" /> {orphans} orphaned
                </span>
              ) : null}
            </h2>
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Schema</TableHead>
                    <TableHead>Database roles</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.users.map((u) => (
                    <TableRow key={u.name} className={u.orphaned ? "bg-amber-500/5" : ""}>
                      <TableCell className="font-mono text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          {u.name}
                          {u.orphaned ? (
                            <Badge variant="secondary" className="text-amber-600">
                              orphaned
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {u.defaultSchema ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {u.databaseRoles.join(", ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      )}
    </WorkspacePage>
  );
}
