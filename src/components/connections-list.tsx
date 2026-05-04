"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Trash2, Circle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import type { ConnectionRecord, TechId } from "@/lib/connections/types";

interface Props {
  tech: TechId;
  refreshKey: number;
  renderSummary?: (record: ConnectionRecord) => React.ReactNode;
}

export function ConnectionsList({
  tech,
  refreshKey,
  renderSummary,
}: Props) {
  const router = useRouter();
  const [records, setRecords] = useState<ConnectionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/connections?tech=${tech}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { connections: ConnectionRecord[] };
      setRecords(data.connections);
    } finally {
      setLoading(false);
    }
  }, [tech]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const remove = async (id: string) => {
    const res = await fetch(`/api/connections/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Connection removed");
      load();
    } else {
      toast.error("Could not remove connection");
    }
  };

  if (loading) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Loading connections…
      </Card>
    );
  }

  if (records.length === 0) {
    return (
      <Card className="p-6 border-dashed text-sm text-muted-foreground">
        No saved connections yet. Test one on the left to add it.
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {records.map((r) => (
        <Card
          key={r.id}
          className="p-4 flex flex-row items-center justify-between gap-4 hover:border-brand/40 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            {r.status === "ok" ? (
              <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
            ) : r.status === "error" ? (
              <AlertCircle className="size-5 text-red-500 shrink-0" />
            ) : (
              <Circle className="size-5 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0">
              <div className="font-medium truncate">{r.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {renderSummary ? renderSummary(r) : r.id}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge
              variant={
                r.status === "ok"
                  ? "default"
                  : r.status === "error"
                    ? "destructive"
                    : "secondary"
              }
            >
              {r.status}
            </Badge>
            <Button
              size="sm"
              onClick={() => router.push(`/${tech}/${r.id}`)}
              disabled={r.status === "error"}
            >
              Open
              <ArrowRight className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => remove(r.id)}
              title="Remove"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
