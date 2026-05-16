"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { DetailBlock } from "@/components/data/detail-block";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Loader2, RefreshCcw } from "lucide-react";

interface VectorParamSummary {
  name: string;
  size: number;
  distance: string;
  onDisk?: boolean;
}

interface PayloadSchemaEntry {
  key: string;
  dataType: string;
  points?: number;
}

interface CollectionDetail {
  name: string;
  vectorsCount: number;
  pointsCount: number;
  segmentsCount: number;
  indexedVectorsCount: number;
  status: string;
  optimizerStatus: string;
  vectors: VectorParamSummary[];
  payloadSchema: PayloadSchemaEntry[];
  raw: unknown;
}

interface PointSummary {
  id: string | number;
  payload: Record<string, unknown> | null;
  vectorDimensions?: number;
  vector?: unknown;
}

interface Props {
  connectionId: string;
  name: string;
}

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

export function CollectionDetailClient({ connectionId, name }: Props) {
  const base = `/api/qdrant/${connectionId}/collections/${encodeURIComponent(name)}`;

  const [tab, setTab] = useState("schema");
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [items, setItems] = useState<PointSummary[] | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [withVector, setWithVector] = useState(false);
  const [selected, setSelected] = useState<PointSummary | null>(null);

  const loadDetail = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setDetail(data.collection as CollectionDetail);
    else toast.error("Could not load collection", { description: data.error });
  }, [base]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const loadSample = useCallback(async () => {
    setLoadingSample(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (withVector) params.set("withVector", "1");
      const res = await fetch(`${base}/sample?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setItems(data.items as PointSummary[]);
      else toast.error("Could not load sample", { description: data.error });
    } finally {
      setLoadingSample(false);
    }
  }, [base, withVector]);

  useEffect(() => {
    if (tab === "sample" && items === null && !loadingSample) {
      loadSample();
    }
  }, [tab, items, loadingSample, loadSample]);

  return (
    <WorkspacePage
      title={<span className="font-mono">{name}</span>}
      description={
        detail
          ? `${formatCompact(detail.pointsCount)} points · ${formatCompact(detail.vectorsCount)} indexed · ${detail.segmentsCount} segments`
          : undefined
      }
      actions={
        <>
          <Link
            href={`/qdrant/${connectionId}/collections`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button size="sm" variant="outline" onClick={loadDetail}>
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

        <TabsContent value="schema" className="pt-4 space-y-4">
          {detail ? (
            <>
              <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border/60">
                  <h3 className="text-sm font-semibold">Vector parameters</h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Distance</TableHead>
                      <TableHead>On-disk</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.vectors.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-xs text-muted-foreground text-center py-6"
                        >
                          No vector configuration reported.
                        </TableCell>
                      </TableRow>
                    ) : (
                      detail.vectors.map((v) => (
                        <TableRow key={v.name}>
                          <TableCell className="font-mono text-xs">
                            {v.name}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {v.size}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {v.distance}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {v.onDisk ? "yes" : "no"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border/60">
                  <h3 className="text-sm font-semibold">Payload schema</h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Indexed pts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.payloadSchema.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="text-xs text-muted-foreground text-center py-6"
                        >
                          No payload indexes — payload values are stored but
                          not searchable. Add a payload index via the Qdrant
                          API to enable filtered search.
                        </TableCell>
                      </TableRow>
                    ) : (
                      detail.payloadSchema.map((p) => (
                        <TableRow key={p.key}>
                          <TableCell className="font-mono text-xs">
                            {p.key}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <span className="inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-700 dark:text-violet-300">
                              {p.dataType}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums text-right text-muted-foreground">
                            {p.points != null ? formatCompact(p.points) : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <p className="text-xs text-muted-foreground">
                Optimizer: <span className="font-mono">{detail.optimizerStatus}</span>
              </p>
            </>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </TabsContent>

        <TabsContent value="sample" className="pt-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={loadSample}
              disabled={loadingSample}
            >
              {loadingSample ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="size-3.5" />
              )}
              Fetch 50
            </Button>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground select-none">
              <input
                type="checkbox"
                checked={withVector}
                onChange={(e) => {
                  setWithVector(e.target.checked);
                  // Stale on toggle: force a refetch when user clicks "Fetch 50"
                  setItems(null);
                }}
                className="accent-foreground"
              />
              Include vector
            </label>
            <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              scroll · ordered by id · capped at 100
            </span>
          </div>

          {loadingSample ? (
            <p className="text-sm text-muted-foreground">Scrolling…</p>
          ) : items === null ? null : items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              Empty collection.
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-auto max-h-[60vh]">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold w-[28%]">
                      ID
                    </th>
                    <th className="px-3 py-2 text-left font-semibold w-[12%]">
                      Dim
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Payload
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr
                      key={String(p.id)}
                      onClick={() => setSelected(p)}
                      className="border-t border-border/30 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-3 py-1.5 align-top break-all">
                        {String(p.id)}
                      </td>
                      <td className="px-3 py-1.5 align-top tabular-nums text-muted-foreground">
                        {p.vectorDimensions != null ? p.vectorDimensions : "—"}
                      </td>
                      <td className="px-3 py-1.5 align-top max-w-[60ch] truncate">
                        {p.payload ? (
                          truncate(JSON.stringify(p.payload), 120)
                        ) : (
                          <span className="text-muted-foreground/50">null</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="config" className="pt-4 space-y-3">
          {detail ? (
            <DetailBlock
              label="Full collection info"
              content={JSON.stringify(detail.raw, null, 2)}
              maxHeightClass="max-h-[70vh]"
            />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </TabsContent>
      </Tabs>

      <PointDetailSheet
        point={selected}
        collection={name}
        onClose={() => setSelected(null)}
      />
    </WorkspacePage>
  );
}

function PointDetailSheet({
  point,
  collection,
  onClose,
}: {
  point: PointSummary | null;
  collection: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={Boolean(point)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="text-base flex items-center gap-2">
            <span className="font-mono">{collection}</span>
            {point ? (
              <span className="text-xs font-mono text-muted-foreground">
                · id{" "}
                <span className="ml-1 inline-block rounded px-1 bg-red-500/10 text-red-700 dark:text-red-300">
                  {String(point.id)}
                </span>
              </span>
            ) : null}
          </SheetTitle>
        </SheetHeader>
        {point ? (
          <div className="flex-1 min-h-0 overflow-auto p-5 space-y-5">
            <MetaRow label="ID">
              <span className="font-mono text-xs break-all">
                {String(point.id)}
              </span>
            </MetaRow>
            <MetaRow label="Vector dim">
              <span className="font-mono text-xs">
                {point.vectorDimensions != null
                  ? `${point.vectorDimensions} dimensions`
                  : "not requested"}
              </span>
            </MetaRow>
            <DetailBlock
              label="Payload"
              content={
                point.payload ? JSON.stringify(point.payload, null, 2) : null
              }
            />
            {point.vector ? (
              <DetailBlock
                label="Vector"
                content={JSON.stringify(point.vector, null, 2)}
                maxHeightClass={cn("max-h-[40vh]")}
              />
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground w-20 shrink-0">
        {label}
      </span>
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
