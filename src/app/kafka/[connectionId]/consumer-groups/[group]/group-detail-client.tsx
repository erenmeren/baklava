"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { ArrowLeft } from "lucide-react";

interface GroupDetail {
  groupId: string;
  state: string;
  members: { memberId: string; clientId: string; clientHost: string }[];
  offsets: {
    topic: string;
    partition: number;
    offset: string;
    high: string;
    lag: number;
  }[];
}

interface Props {
  connectionId: string;
  group: string;
}

export function GroupDetailClient({ connectionId, group }: Props) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/kafka/${connectionId}/consumer-groups/${encodeURIComponent(group)}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    if (res.ok) setDetail(data as GroupDetail);
    else toast.error("Could not load", { description: data.error });
  }, [connectionId, group]);

  useEffect(() => {
    load();
  }, [load]);

  const totalLag = detail?.offsets.reduce((sum, o) => sum + o.lag, 0) ?? 0;

  return (
    <WorkspacePage
      title={<span className="font-mono">{group}</span>}
      description={
        detail ? (
          <span className="inline-flex items-center gap-2">
            <Badge
              variant={
                detail.state === "Stable" ? "default" : "secondary"
              }
            >
              {detail.state}
            </Badge>
            <span className="text-xs">
              {detail.members.length} member(s) · {totalLag.toLocaleString()}{" "}
              lag
            </span>
          </span>
        ) : undefined
      }
      actions={
        <Link
          href={`/kafka/${connectionId}/consumer-groups`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Link>
      }
    >
      <div className="space-y-6">
        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Members
          </h2>
          {detail ? (
            detail.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members.</p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member ID</TableHead>
                      <TableHead>Client ID</TableHead>
                      <TableHead>Host</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.members.map((m) => (
                      <TableRow key={m.memberId}>
                        <TableCell className="font-mono text-xs break-all">
                          {m.memberId}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {m.clientId}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {m.clientHost}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            <Skeleton className="h-20 w-full" />
          )}
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Topic offsets &amp; lag
          </h2>
          {detail ? (
            detail.offsets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No offsets.</p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Topic</TableHead>
                      <TableHead>Partition</TableHead>
                      <TableHead>Current offset</TableHead>
                      <TableHead>Log end</TableHead>
                      <TableHead>Lag</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.offsets.map((o) => (
                      <TableRow key={`${o.topic}.${o.partition}`}>
                        <TableCell className="font-mono text-xs">
                          {o.topic}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {o.partition}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {o.offset}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {o.high}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {o.lag > 0 ? (
                            <Badge variant="destructive">
                              {o.lag.toLocaleString()}
                            </Badge>
                          ) : (
                            o.lag
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </section>
      </div>
    </WorkspacePage>
  );
}
