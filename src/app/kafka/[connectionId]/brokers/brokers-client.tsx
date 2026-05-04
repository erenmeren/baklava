"use client";

import { useCallback, useEffect, useState } from "react";
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

interface Broker {
  nodeId: number;
  host: string;
  port: number;
  rack?: string;
  isController: boolean;
}

interface Props {
  connectionId: string;
}

export function BrokersClient({ connectionId }: Props) {
  const [brokers, setBrokers] = useState<Broker[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/kafka/${connectionId}/brokers`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setBrokers(data.brokers as Broker[]);
    else toast.error("Could not load", { description: data.error });
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <WorkspacePage
      title="Brokers"
      description={
        brokers
          ? `${brokers.length} broker${brokers.length === 1 ? "" : "s"} online`
          : undefined
      }
      actions={
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCcw className="size-3.5" />
          Refresh
        </Button>
      }
    >
      {brokers === null ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Node ID</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Port</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brokers.map((b) => (
                <TableRow key={b.nodeId}>
                  <TableCell className="font-mono text-xs">
                    {b.nodeId}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{b.host}</TableCell>
                  <TableCell className="font-mono text-xs">{b.port}</TableCell>
                  <TableCell>
                    {b.isController ? (
                      <Badge>controller</Badge>
                    ) : null}
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
