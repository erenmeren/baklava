"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { RefreshCcw } from "lucide-react";

interface ConsumerGroup {
  groupId: string;
  protocolType: string;
  state?: string;
}

interface Props {
  connectionId: string;
}

export function ConsumerGroupsClient({ connectionId }: Props) {
  const [groups, setGroups] = useState<ConsumerGroup[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/kafka/${connectionId}/consumer-groups`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setGroups(data.groups as ConsumerGroup[]);
    else toast.error("Could not load", { description: data.error });
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <WorkspacePage
      title="Consumer groups"
      description={
        groups
          ? `${groups.length} group${groups.length === 1 ? "" : "s"}`
          : undefined
      }
      actions={
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCcw className="size-3.5" />
          Refresh
        </Button>
      }
    >
      {groups === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          No consumer groups.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group ID</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Protocol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.groupId}>
                  <TableCell>
                    <Link
                      href={`/kafka/${connectionId}/consumer-groups/${encodeURIComponent(g.groupId)}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {g.groupId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {g.state ? (
                      <Badge
                        variant={
                          g.state === "Stable" ? "default" : "secondary"
                        }
                      >
                        {g.state}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {g.protocolType}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </WorkspacePage>
  );
}
