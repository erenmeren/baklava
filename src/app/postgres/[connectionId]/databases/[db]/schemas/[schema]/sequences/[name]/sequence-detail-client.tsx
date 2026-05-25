"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Pencil, Trash } from "lucide-react";
import { RefreshButton } from "@/components/workspace/auto-refresh";
import { toast } from "sonner";
import {
  SequenceFormDialog,
  type SequenceFormSeed,
} from "../../../../../../sequence-form-dialog";

interface SequenceInfo {
  name: string;
  dataType: string;
  startValue: string;
  minValue: string;
  maxValue: string;
  increment: string;
  lastValue: string | null;
}

interface Props {
  connectionId: string;
  db: string;
  schema: string;
  name: string;
}

export function SequenceDetailClient({
  connectionId,
  db,
  schema,
  name,
}: Props) {
  const router = useRouter();

  const [seq, setSeq] = useState<SequenceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [dropping, setDropping] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/sequences`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error("Could not load sequences", { description: data.error });
        return;
      }
      const match = (data.sequences as SequenceInfo[]).find(
        (s) => s.name === name,
      );
      setSeq(match ?? null);
    } finally {
      setLoading(false);
    }
  }, [connectionId, db, schema, name]);

  useEffect(() => {
    load();
  }, [load]);

  const drop = async () => {
    setDropping(true);
    try {
      const url = `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/sequences/${encodeURIComponent(name)}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Drop failed", { description: data.error });
        return;
      }
      toast.success(`Dropped ${schema}.${name}`);
      router.push(`/postgres/${connectionId}`);
    } finally {
      setDropping(false);
    }
  };

  const seed: SequenceFormSeed | null = seq
    ? {
        name: seq.name,
        start: seq.startValue,
        increment: seq.increment,
        minValue: seq.minValue,
        maxValue: seq.maxValue,
        cache: "1",
        cycle: false,
      }
    : null;

  return (
    <WorkspacePage
      title={
        <span className="font-mono">
          {schema}.{name}
        </span>
      }
      description={
        <span className="text-xs">
          Sequence · database <span className="font-mono">{db}</span>
        </span>
      }
      actions={
        <>
          <RefreshButton onClick={load} loading={loading} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditOpen(true)}
            disabled={!seq}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDropOpen(true)}
            className="text-destructive hover:text-destructive"
          >
            <Trash className="size-3.5" />
            Drop
          </Button>
        </>
      }
    >
      {!seq ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <section>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Current value
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <Card
                label="Last value"
                value={seq.lastValue ?? "—"}
                hint={
                  seq.lastValue
                    ? "the most recent nextval()"
                    : "no nextval() called yet"
                }
              />
              <Card label="Data type" value={seq.dataType} />
            </div>
          </section>

          <section>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Configuration
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <Card label="Start with" value={seq.startValue} />
              <Card label="Increment by" value={seq.increment} />
              <Card
                label="Min value"
                value={seq.minValue}
                hint="NO MINVALUE if at type lower bound"
              />
              <Card
                label="Max value"
                value={seq.maxValue}
                hint="NO MAXVALUE if at type upper bound"
              />
            </div>
          </section>
        </div>
      )}

      {seed ? (
        <SequenceFormDialog
          mode="edit"
          open={editOpen}
          onOpenChange={setEditOpen}
          connectionId={connectionId}
          database={db}
          schema={schema}
          initial={seed}
          onSuccess={() => load()}
        />
      ) : null}

      <AlertDialog
        open={dropOpen}
        onOpenChange={(v) => !dropping && setDropOpen(v)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop sequence?</AlertDialogTitle>
            <AlertDialogDescription>
              This will run{" "}
              <span className="font-mono">
                DROP SEQUENCE {schema}.{name}
              </span>
              . Owned columns will lose their default; this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dropping}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                drop();
              }}
              disabled={dropping}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {dropping ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Drop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
      <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground/80">
        {label}
      </div>
      <div className="mt-1 text-[16px] font-mono text-foreground tabular-nums break-all">
        {value}
      </div>
      {hint ? (
        <div className="text-[10.5px] font-mono text-muted-foreground mt-0.5">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
