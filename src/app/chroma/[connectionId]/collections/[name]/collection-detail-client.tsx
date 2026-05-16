"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { DetailBlock } from "@/components/data/detail-block";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, RefreshCcw } from "lucide-react";

interface ChromaCollectionDetail {
  name: string;
  id: string;
  count: number;
  metadata: Record<string, unknown>;
  configuration: Record<string, unknown>;
  metadataFields: { name: string; type: string }[];
  distanceFunction: string;
  embeddingFunctionName: string;
  hnswParams: Record<string, unknown> | null;
}

interface SampleItem {
  id: string;
  document: string | null;
  metadata: Record<string, unknown> | null;
  embeddingDim: number | null;
}

interface SampleDetail extends SampleItem {
  embeddingHead: number[];
  embeddingTail: number[];
}

interface Props {
  connectionId: string;
  collectionName: string;
}

export function CollectionDetailClient({
  connectionId,
  collectionName,
}: Props) {
  const base = `/api/chroma/${connectionId}/collections/${encodeURIComponent(collectionName)}`;

  const [tab, setTab] = useState("schema");
  const [detail, setDetail] = useState<ChromaCollectionDetail | null>(null);

  const [sample, setSample] = useState<SampleItem[] | null>(null);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SampleDetail | null>(
    null
  );
  const [selectedLoading, setSelectedLoading] = useState(false);

  const loadDetail = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setDetail(data.collection as ChromaCollectionDetail);
    else toast.error("Could not load collection", { description: data.error });
  }, [base]);

  const loadSample = useCallback(async () => {
    setSampleLoading(true);
    setSampleNote(null);
    try {
      const res = await fetch(`${base}/sample?limit=50`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setSample(data.items as SampleItem[]);
        if (data.note) setSampleNote(data.note);
      } else {
        toast.error("Could not load sample", { description: data.error });
      }
    } finally {
      setSampleLoading(false);
    }
  }, [base]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (tab === "sample" && sample === null && !sampleLoading) {
      loadSample();
    }
  }, [tab, sample, sampleLoading, loadSample]);

  // Fetch full vector when a row is selected
  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    setSelectedLoading(true);
    setSelectedDetail(null);
    fetch(`${base}/sample?id=${encodeURIComponent(selectedId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.item) setSelectedDetail(data.item as SampleDetail);
      })
      .finally(() => {
        if (!cancelled) setSelectedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [base, selectedId]);

  return (
    <WorkspacePage
      title={<span className="font-mono">{collectionName}</span>}
      description={
        detail
          ? `${detail.count.toLocaleString()} document${detail.count === 1 ? "" : "s"} · ${detail.distanceFunction}`
          : undefined
      }
      actions={
        <>
          <Link
            href={`/chroma/${connectionId}/collections`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              loadDetail();
              if (tab === "sample") loadSample();
            }}
          >
            <RefreshCcw className="size-3.5" />
            Refresh
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="sample">Sample</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="schema" className="pt-4">
          {detail ? (
            <SchemaTab detail={detail} />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="sample" className="pt-4 space-y-3">
          {sampleLoading ? (
            <p className="text-sm text-muted-foreground">Peeking…</p>
          ) : sample === null ? (
            <Skeleton className="h-32 w-full" />
          ) : sample.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {sampleNote ?? "No documents."}
            </p>
          ) : (
            <SampleTable rows={sample} onSelect={setSelectedId} />
          )}
        </TabsContent>

        <TabsContent value="config" className="pt-4 space-y-4">
          {detail ? <ConfigTab detail={detail} /> : null}
        </TabsContent>
      </Tabs>

      <SampleRowSheet
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        item={selectedDetail}
        loading={selectedLoading}
        fallbackId={selectedId}
      />
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SchemaTab({ detail }: { detail: ChromaCollectionDetail }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Meta label="Collection ID" value={detail.id || "—"} mono />
        <Meta label="Distance" value={detail.distanceFunction || "—"} />
        <Meta
          label="Embedding fn"
          value={detail.embeddingFunctionName || "default"}
        />
        <Meta label="Documents" value={detail.count.toLocaleString()} />
      </div>
      {detail.metadataFields.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          No metadata fields detected in sample.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metadata field</TableHead>
                <TableHead className="w-[140px]">Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.metadataFields.map((f) => (
                <TableRow key={f.name}>
                  <TableCell className="font-mono text-xs">{f.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-mono uppercase tracking-wider"
                    >
                      {f.type}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {detail.hnswParams ? (
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2">
            HNSW parameters
          </p>
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono overflow-auto">
            {Object.entries(detail.hnswParams).map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="text-muted-foreground w-40 shrink-0">{k}</span>
                <span>{JSON.stringify(v)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SampleTable({
  rows,
  onSelect,
}: {
  rows: SampleItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 overflow-auto max-h-[60vh]">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 sticky top-0 z-10">
          <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <th className="px-3 py-2 text-left font-semibold w-[18%]">ID</th>
            <th className="px-3 py-2 text-left font-semibold">Document</th>
            <th className="px-3 py-2 text-left font-semibold w-[24%]">
              Metadata
            </th>
            <th className="px-3 py-2 text-left font-semibold w-[110px]">Dim</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect(r.id)}
              className="border-t border-border/30 cursor-pointer hover:bg-muted/40 transition-colors"
            >
              <td className="px-3 py-1.5 align-top font-mono text-muted-foreground truncate max-w-[18ch]">
                {r.id}
              </td>
              <td className="px-3 py-1.5 align-top font-mono truncate max-w-[60ch]">
                {r.document ?? (
                  <span className="text-muted-foreground/50">null</span>
                )}
              </td>
              <td className="px-3 py-1.5 align-top font-mono text-muted-foreground truncate max-w-[30ch]">
                {r.metadata && Object.keys(r.metadata).length > 0
                  ? JSON.stringify(r.metadata)
                  : "—"}
              </td>
              <td className="px-3 py-1.5 align-top font-mono tabular-nums">
                {r.embeddingDim != null ? (
                  <Badge
                    variant="secondary"
                    className="text-[9px] font-mono bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/30"
                  >
                    {r.embeddingDim}d
                  </Badge>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SampleRowSheet({
  open,
  onClose,
  item,
  loading,
  fallbackId,
}: {
  open: boolean;
  onClose: () => void;
  item: SampleDetail | null;
  loading: boolean;
  fallbackId: string | null;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="text-base font-mono truncate">
            {item?.id ?? fallbackId ?? "Document"}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-auto p-5 space-y-5">
          {loading || !item ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <>
              <DetailBlock label="Document" content={item.document} />
              <DetailBlock
                label="Metadata"
                content={
                  item.metadata && Object.keys(item.metadata).length > 0
                    ? JSON.stringify(item.metadata, null, 2)
                    : null
                }
              />
              {item.embeddingDim != null ? (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2">
                    Embedding
                    <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-700 dark:text-pink-300 border border-pink-500/30 normal-case tracking-normal">
                      float × {item.embeddingDim}
                    </span>
                  </p>
                  <pre className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[30vh] overflow-auto">
                    {`[`}
                    {item.embeddingHead.map((n) => formatFloat(n)).join(", ")}
                    {item.embeddingTail.length > 0
                      ? `, … (${item.embeddingDim - item.embeddingHead.length - item.embeddingTail.length} more), `
                      : item.embeddingDim > item.embeddingHead.length
                        ? `, …`
                        : ""}
                    {item.embeddingTail.map((n) => formatFloat(n)).join(", ")}
                    {`]`}
                  </pre>
                </div>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function formatFloat(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(4);
}

// ─────────────────────────────────────────────────────────────────────────────

function ConfigTab({ detail }: { detail: ChromaCollectionDetail }) {
  return (
    <div className="space-y-4">
      <DetailBlock
        label="configuration_json"
        content={
          Object.keys(detail.configuration).length === 0
            ? null
            : JSON.stringify(detail.configuration, null, 2)
        }
      />
      <DetailBlock
        label="collection metadata"
        content={
          Object.keys(detail.metadata).length === 0
            ? null
            : JSON.stringify(detail.metadata, null, 2)
        }
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 p-3">
      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-1">
        {label}
      </p>
      <p
        className={cn(
          "text-sm",
          mono && "font-mono text-xs",
          !mono && "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}
