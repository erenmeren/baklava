"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

interface PropertySummary {
  name: string;
  dataType: string;
  description?: string;
  tokenization?: string;
}

interface CollectionDetail {
  name: string;
  description?: string;
  vectorizer: string;
  properties: PropertySummary[];
  raw: unknown;
}

interface ObjectSummary {
  uuid: string;
  properties: Record<string, unknown>;
  vectorDimensions?: number;
  vectors?: Record<string, unknown>;
  creationTime?: string | null;
  lastUpdateTime?: string | null;
}

interface Props {
  connectionId: string;
  name: string;
}

const DATATYPE_TONES: Record<string, string> = {
  text: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  int: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  number:
    "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  boolean:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  date: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  uuid: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  geoCoordinates:
    "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  blob: "border-stone-500/40 bg-stone-500/10 text-stone-700 dark:text-stone-300",
  object:
    "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
};

function dataTypeTone(dataType: string): string {
  // dataType may be a list joined with ", " — colour on the first element.
  const head = dataType.split(",")[0]?.trim() ?? dataType;
  return (
    DATATYPE_TONES[head] ??
    "border-border/60 bg-muted/40 text-muted-foreground"
  );
}

export function CollectionDetailClient({ connectionId, name }: Props) {
  const base = `/api/weaviate/${connectionId}/collections/${encodeURIComponent(name)}`;

  const [tab, setTab] = useState("properties");
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [items, setItems] = useState<ObjectSummary[] | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [withVector, setWithVector] = useState(false);
  const [selected, setSelected] = useState<ObjectSummary | null>(null);

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
      if (res.ok) setItems(data.items as ObjectSummary[]);
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

  // Pick the first 3 properties to use as table columns in the Sample tab.
  const sampleColumns = useMemo(() => {
    if (!detail) return [];
    return detail.properties.slice(0, 3).map((p) => p.name);
  }, [detail]);

  return (
    <WorkspacePage
      title={<span className="font-mono">{name}</span>}
      description={
        detail
          ? `${detail.properties.length} propert${detail.properties.length === 1 ? "y" : "ies"} · ${detail.vectorizer}`
          : undefined
      }
      actions={
        <>
          <Link
            href={`/weaviate/${connectionId}/collections`}
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
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="sample">Sample</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
        </TabsList>

        <TabsContent value="properties" className="pt-4">
          {detail ? (
            <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Tokenization</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.properties.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-xs text-muted-foreground text-center py-6"
                      >
                        No properties declared on this collection.
                      </TableCell>
                    </TableRow>
                  ) : (
                    detail.properties.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell className="font-mono text-xs">
                          {p.name}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-mono",
                              dataTypeTone(p.dataType)
                            )}
                          >
                            {p.dataType}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {p.tokenization ?? (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.description?.trim() || (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
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
                  setItems(null);
                }}
                className="accent-foreground"
              />
              Include vector
            </label>
            <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              fetchObjects · gRPC · capped at 100
            </span>
          </div>

          {loadingSample ? (
            <p className="text-sm text-muted-foreground">Fetching…</p>
          ) : items === null ? null : items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              Empty collection.
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-auto max-h-[60vh]">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold w-[20%]">
                      UUID
                    </th>
                    {sampleColumns.map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2 text-left font-semibold"
                      >
                        {col}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left font-semibold w-[10%]">
                      Dim
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((o) => (
                    <tr
                      key={o.uuid}
                      onClick={() => setSelected(o)}
                      className="border-t border-border/30 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-3 py-1.5 align-top text-muted-foreground truncate max-w-[20ch]">
                        {o.uuid}
                      </td>
                      {sampleColumns.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-1.5 align-top max-w-[40ch] truncate"
                        >
                          {renderCell(o.properties[col])}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 align-top tabular-nums text-muted-foreground">
                        {o.vectorDimensions != null ? o.vectorDimensions : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="schema" className="pt-4 space-y-3">
          {detail ? (
            <DetailBlock
              label="Full collection config"
              content={JSON.stringify(detail.raw, null, 2)}
              maxHeightClass="max-h-[70vh]"
            />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </TabsContent>
      </Tabs>

      <ObjectDetailSheet
        object={selected}
        collection={name}
        onClose={() => setSelected(null)}
      />
    </WorkspacePage>
  );
}

function renderCell(value: unknown): React.ReactNode {
  if (value == null) return <span className="text-muted-foreground/50">—</span>;
  if (typeof value === "string") return truncate(value, 80);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return truncate(JSON.stringify(value), 80);
  } catch {
    return String(value);
  }
}

function ObjectDetailSheet({
  object,
  collection,
  onClose,
}: {
  object: ObjectSummary | null;
  collection: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={Boolean(object)}
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
            {object ? (
              <span className="text-xs font-mono text-muted-foreground truncate">
                · uuid{" "}
                <span className="ml-1 inline-block rounded px-1 bg-green-500/10 text-green-700 dark:text-green-300">
                  {object.uuid.slice(0, 8)}…
                </span>
              </span>
            ) : null}
          </SheetTitle>
        </SheetHeader>
        {object ? (
          <div className="flex-1 min-h-0 overflow-auto p-5 space-y-5">
            <MetaRow label="UUID">
              <span className="font-mono text-xs break-all">{object.uuid}</span>
            </MetaRow>
            <MetaRow label="Vector dim">
              <span className="font-mono text-xs">
                {object.vectorDimensions != null
                  ? `${object.vectorDimensions} dimensions`
                  : "not requested"}
              </span>
            </MetaRow>
            {object.creationTime ? (
              <MetaRow label="Created">
                <span className="font-mono text-xs">{object.creationTime}</span>
              </MetaRow>
            ) : null}
            {object.lastUpdateTime ? (
              <MetaRow label="Updated">
                <span className="font-mono text-xs">
                  {object.lastUpdateTime}
                </span>
              </MetaRow>
            ) : null}
            <DetailBlock
              label="Properties"
              content={JSON.stringify(object.properties, null, 2)}
            />
            {object.vectors ? (
              <DetailBlock
                label="Vectors"
                content={JSON.stringify(object.vectors, null, 2)}
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
