"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Sparkline } from "@/components/workspace/sparkline";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  Check,
  ChevronsRight,
  Columns3,
  Copy,
  Download,
  Eraser,
  Eye,
  FileJson,
  Headphones,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pause,
  RadioTower,
  RefreshCcw,
  Rows3,
  Search,
  Send,
  Sparkles,
  Terminal,
  X,
  Zap,
} from "lucide-react";

interface PartitionInfo {
  partition: number;
  leader: number;
  offset: string;
  high: string;
}

export interface DecodedPayloadView {
  schemaId: number;
  schemaType: "AVRO" | "JSON" | "PROTOBUF";
  subject: string | null;
  version: number | null;
  json: string | null;
  note?: string;
}

export interface KafkaMessage {
  partition: number;
  offset: string;
  timestamp: string;
  key: string | null;
  keyBase64?: string | null;
  value: string | null;
  valueBase64?: string | null;
  valueDecoded?: DecodedPayloadView;
  headers: Record<string, string>;
}

/**
 * What the UI should treat as the rendered value: prefer the decoded JSON
 * form when present (Avro / JSON-Schema), fall back to raw UTF-8.
 */
export function displayValue(m: KafkaMessage): string | null {
  if (m.valueDecoded?.json) return m.valueDecoded.json;
  return m.value;
}

export interface ProduceTemplate {
  key?: string;
  value: string;
  headers: Record<string, string>;
}

interface Props {
  base: string;
  topic: string;
  partitions: PartitionInfo[];
  /** Called when the user picks "Produce similar" in the detail drawer. */
  onProduceSimilar?: (template: ProduceTemplate) => void;
}

const BUFFER_CAP = 500;
const THROUGHPUT_BUCKETS = 30; // 30 × 1s = 30 second rolling rate chart
const THROUGHPUT_INTERVAL_MS = 1000;

// ─── partition color palette ─────────────────────────────────────────────
// Stable per-partition hue so the eye groups them at a glance. Picked from
// the Baklava color family — warm/honey/teal/violet — with enough contrast
// across both themes.
const PARTITION_PALETTE: { bg: string; text: string; border: string; dot: string }[] = [
  { bg: "bg-amber-500/10",   text: "text-amber-700 dark:text-amber-300",   border: "border-amber-500/30",  dot: "bg-amber-500" },
  { bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-500/30", dot: "bg-emerald-500" },
  { bg: "bg-sky-500/10",     text: "text-sky-700 dark:text-sky-300",       border: "border-sky-500/30",    dot: "bg-sky-500" },
  { bg: "bg-violet-500/10",  text: "text-violet-700 dark:text-violet-300", border: "border-violet-500/30", dot: "bg-violet-500" },
  { bg: "bg-rose-500/10",    text: "text-rose-700 dark:text-rose-300",     border: "border-rose-500/30",   dot: "bg-rose-500" },
  { bg: "bg-teal-500/10",    text: "text-teal-700 dark:text-teal-300",     border: "border-teal-500/30",   dot: "bg-teal-500" },
  { bg: "bg-indigo-500/10",  text: "text-indigo-700 dark:text-indigo-300", border: "border-indigo-500/30", dot: "bg-indigo-500" },
  { bg: "bg-fuchsia-500/10", text: "text-fuchsia-700 dark:text-fuchsia-300", border: "border-fuchsia-500/30", dot: "bg-fuchsia-500" },
  { bg: "bg-orange-500/10",  text: "text-orange-700 dark:text-orange-300", border: "border-orange-500/30", dot: "bg-orange-500" },
  { bg: "bg-cyan-500/10",    text: "text-cyan-700 dark:text-cyan-300",     border: "border-cyan-500/30",   dot: "bg-cyan-500" },
];

function partitionTone(p: number) {
  return PARTITION_PALETTE[((p % PARTITION_PALETTE.length) + PARTITION_PALETTE.length) % PARTITION_PALETTE.length];
}

function PartitionBadge({ partition, size = "sm" }: { partition: number; size?: "sm" | "md" }) {
  const tone = partitionTone(partition);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded font-mono tabular-nums",
        "border",
        tone.bg,
        tone.text,
        tone.border,
        size === "sm"
          ? "min-w-[22px] px-1 py-0 text-[10px]"
          : "min-w-[28px] px-1.5 py-0.5 text-xs",
      )}
      title={`partition ${partition}`}
    >
      {partition}
    </span>
  );
}

// ─── value-type detection ────────────────────────────────────────────────
type ValueType = "null" | "json" | "xml" | "number" | "binary" | "text";

function detectValueType(v: string | null): ValueType {
  if (v == null) return "null";
  if (v.length === 0) return "text";
  const t = v.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      /* fall through */
    }
  }
  if (t.startsWith("<") && t.endsWith(">") && /<[^>]+>/.test(t)) return "xml";
  if (/^-?\d+(\.\d+)?$/.test(t)) return "number";
  // Heuristic: count high non-printable bytes. Cheap binary detector.
  let nonPrintable = 0;
  for (let i = 0; i < Math.min(v.length, 256); i++) {
    const code = v.charCodeAt(i);
    if ((code < 9 || (code > 13 && code < 32)) && code !== 0) nonPrintable++;
  }
  if (nonPrintable > 4) return "binary";
  return "text";
}

const TYPE_TONE: Record<ValueType, string> = {
  json:   "text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  xml:    "text-sky-600 dark:text-sky-400 border-sky-500/30 bg-sky-500/10",
  number: "text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10",
  binary: "text-rose-600 dark:text-rose-400 border-rose-500/30 bg-rose-500/10",
  text:   "text-muted-foreground border-border/60 bg-muted/40",
  null:   "text-muted-foreground/60 border-border/60 bg-muted/30",
};

function ValueTypeChip({ type }: { type: ValueType }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1 py-0 text-[9px] font-mono uppercase tracking-wider border",
        TYPE_TONE[type],
      )}
      title={`value type · ${type}`}
    >
      {type}
    </span>
  );
}

const SCHEMA_TONE: Record<DecodedPayloadView["schemaType"], string> = {
  AVRO: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  JSON: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30",
  PROTOBUF: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30",
};

function SchemaChip({ d }: { d: DecodedPayloadView }) {
  const titleParts = [
    `Schema id ${d.schemaId}`,
    d.subject ? `subject: ${d.subject}` : null,
    d.version != null ? `v${d.version}` : null,
    d.note,
  ].filter(Boolean);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 py-0 text-[9px] font-mono uppercase tracking-wider border",
        SCHEMA_TONE[d.schemaType],
      )}
      title={titleParts.join(" · ")}
    >
      {d.schemaType}
      <span className="opacity-70">#{d.schemaId}</span>
    </span>
  );
}

// ─── time helpers ────────────────────────────────────────────────────────
function formatTimeShort(ts: string): string {
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString().slice(11, 23);
}
function relativeFromTimestamp(ts: string): string {
  const n = Number(ts);
  if (!Number.isFinite(n)) return "";
  const diff = (Date.now() - n) / 1000;
  if (diff < 60) return `${Math.max(0, Math.round(diff))}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86_400)}d ago`;
}

// ─── JSON helpers ────────────────────────────────────────────────────────
function prettyPrintJson(s: string | null): string {
  if (s == null) return "";
  const trimmed = s.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      /* fall through */
    }
  }
  return s;
}

/**
 * Minimal JSON syntax highlighter — replaces tokens with span markup using
 * Tailwind classes. Operates on a string of pretty-printed JSON. Pure
 * regex; no AST. Good enough for inspection, no new dep.
 */
function highlightJson(pretty: string): string {
  // Escape HTML to be safe (we render via dangerouslySetInnerHTML).
  const escaped = pretty
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g,
    (_m, str, colon, kw, num) => {
      if (str) {
        if (colon) {
          return `<span class="text-violet-600 dark:text-violet-300">${str}</span>${colon}`;
        }
        return `<span class="text-emerald-700 dark:text-emerald-400">${str}</span>`;
      }
      if (kw) {
        return `<span class="text-amber-700 dark:text-amber-400">${kw}</span>`;
      }
      if (num) {
        return `<span class="text-sky-700 dark:text-sky-400">${num}</span>`;
      }
      return _m;
    },
  );
}

// ─── shell escape (for "copy as curl/kcat") ──────────────────────────────
function shellQuote(s: string): string {
  if (s.length === 0) return "''";
  if (/^[A-Za-z0-9_./:@%+,=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// ─────────────────────────────────────────────────────────────────────────
// MessagesTab — the full component
// ─────────────────────────────────────────────────────────────────────────

export function MessagesTab({ base, topic, partitions, onProduceSimilar }: Props) {
  const [messages, setMessages] = useState<KafkaMessage[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [partitionFilter, setPartitionFilter] = useState<string>("all");
  const [fromBeginning, setFromBeginning] = useState(true);
  const [live, setLive] = useState(false);
  const [keyFilter, setKeyFilter] = useState("");
  const [valueFilter, setValueFilter] = useState("");
  const [headerFilter, setHeaderFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [drawerMessage, setDrawerMessage] = useState<KafkaMessage | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "lanes">("table");
  const sourceRef = useRef<EventSource | null>(null);

  // ─ throughput tracking ─────────────────────────────────────────────────
  // Ring buffer of message-receive timestamps (ms). Trimmed to the last
  // THROUGHPUT_BUCKETS seconds.
  const receivedRef = useRef<number[]>([]);
  const [throughput, setThroughput] = useState<number[]>([]); // per-second buckets
  const recordReceive = useCallback(() => {
    receivedRef.current.push(Date.now());
  }, []);
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const cutoff = now - THROUGHPUT_BUCKETS * THROUGHPUT_INTERVAL_MS;
      const arr = receivedRef.current;
      while (arr.length > 0 && arr[0] < cutoff) arr.shift();
      const buckets = new Array(THROUGHPUT_BUCKETS).fill(0) as number[];
      for (const ts of arr) {
        const bin = Math.floor((now - ts) / THROUGHPUT_INTERVAL_MS);
        const idx = THROUGHPUT_BUCKETS - 1 - bin;
        if (idx >= 0 && idx < THROUGHPUT_BUCKETS) buckets[idx] += 1;
      }
      setThroughput(buckets);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);

  const loadMessages = useCallback(async () => {
    setLoadingMessages(true);
    setMessages(null);
    receivedRef.current = [];
    try {
      const params = new URLSearchParams();
      params.set("limit", "100");
      params.set("from", fromBeginning ? "beginning" : "end");
      if (partitionFilter !== "all") params.set("partition", partitionFilter);
      const res = await fetch(`${base}/messages?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) {
        // Always display newest-first (matches live tail). kafkajs
        // delivers messages partition-by-partition in offset order, so
        // without an explicit sort the table is grouped by partition,
        // not time.
        const msgs = (data.messages as KafkaMessage[])
          .slice()
          .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
        setMessages(msgs);
        // Seed throughput so the chart isn't empty on first paint.
        for (let i = 0; i < msgs.length; i++) {
          receivedRef.current.push(Date.now());
        }
      } else {
        toast.error("Could not load messages", { description: data.error });
      }
    } finally {
      setLoadingMessages(false);
    }
  }, [base, partitionFilter, fromBeginning]);

  // Open / close live tail
  useEffect(() => {
    if (!live) {
      sourceRef.current?.close();
      sourceRef.current = null;
      return;
    }
    setMessages([]);
    receivedRef.current = [];
    const params = new URLSearchParams();
    params.set("fromBeginning", fromBeginning ? "1" : "0");
    if (partitionFilter !== "all") params.set("partition", partitionFilter);
    const es = new EventSource(`${base}/stream?${params.toString()}`);
    sourceRef.current = es;
    es.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse((ev as MessageEvent).data) as KafkaMessage;
        recordReceive();
        setMessages((prev) => {
          const next = [msg, ...(prev ?? [])];
          if (next.length > BUFFER_CAP) next.length = BUFFER_CAP;
          return next;
        });
      } catch {
        // ignore
      }
    });
    es.addEventListener("error", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data ?? "{}") as { message?: string };
        if (data.message) toast.error("Live tail error", { description: data.message });
      } catch {
        /* network error has no payload */
      }
    });
    return () => {
      es.close();
      if (sourceRef.current === es) sourceRef.current = null;
    };
  }, [live, base, partitionFilter, fromBeginning, recordReceive]);

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  // Re-fetch whenever the partition filter or "from beginning" toggle
  // changes (in non-live mode). Live mode has its own effect that tears
  // down + reopens the SSE on the same dep change, so this stays out of
  // its way.
  useEffect(() => {
    if (live) return;
    void loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partitionFilter, fromBeginning, live]);

  // ─ filtering ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!messages) return [];
    const kq = keyFilter.trim().toLowerCase();
    const vq = valueFilter.trim().toLowerCase();
    const hq = headerFilter.trim().toLowerCase();
    if (!kq && !vq && !hq) return messages;
    return messages.filter((m) => {
      if (kq && !(m.key ?? "").toLowerCase().includes(kq)) return false;
      if (vq) {
        const dv = (displayValue(m) ?? "").toLowerCase();
        const raw = (m.value ?? "").toLowerCase();
        if (!dv.includes(vq) && !raw.includes(vq)) return false;
      }
      if (hq) {
        const hay = Object.entries(m.headers)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
          .toLowerCase();
        if (!hay.includes(hq)) return false;
      }
      return true;
    });
  }, [messages, keyFilter, valueFilter, headerFilter]);

  // Auto-hide key column when no visible message has a key.
  const showKeyColumn = useMemo(
    () => filtered.some((m) => m.key != null && m.key.length > 0),
    [filtered],
  );

  const recentRate = useMemo(() => {
    // Recent rate = avg of last 5 buckets
    const tail = throughput.slice(-5);
    if (tail.length === 0) return 0;
    return tail.reduce((s, v) => s + v, 0) / tail.length;
  }, [throughput]);

  // Reset focused index when filter / message list changes
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(filtered.length === 0 ? -1 : 0);
    }
  }, [filtered.length, selectedIndex]);

  // Jump-to-offset state
  const [jumpPartition, setJumpPartition] = useState("0");
  const [jumpOffset, setJumpOffset] = useState("");
  const [jumpBusy, setJumpBusy] = useState(false);

  const jumpToOffset = useCallback(async () => {
    const p = Number(jumpPartition);
    const o = jumpOffset.trim();
    if (!Number.isInteger(p) || p < 0) {
      toast.error("Partition must be a non-negative integer");
      return;
    }
    if (!o) {
      toast.error("Enter an offset");
      return;
    }
    setJumpBusy(true);
    setLive(false);
    try {
      const res = await fetch(`${base}/messages/seek`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ partition: p, offset: o, limit: 50 }),
      });
      const data = await res.json();
      if (res.ok) {
        const msgs = (data.messages as KafkaMessage[])
          .slice()
          .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
        setMessages(msgs);
        receivedRef.current = msgs.map(() => Date.now());
        toast.success(`Fetched ${msgs.length} messages from ${p}@${o}`);
      } else {
        toast.error(data.error || "Jump failed");
      }
    } finally {
      setJumpBusy(false);
    }
  }, [base, jumpPartition, jumpOffset]);

  // ─ download buffer as JSONL ──────────────────────────────────────────
  const downloadJsonl = useCallback(() => {
    if (!messages || messages.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const body = messages.map((m) => JSON.stringify(m)).join("\n");
    const blob = new Blob([body], { type: "application/x-jsonlines" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${topic.replace(/[^A-Za-z0-9._-]/g, "_")}-messages.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages, topic]);

  return (
    <div
      className="space-y-3 outline-none focus:outline-none focus-visible:outline-none"
      tabIndex={0}
      // Kill the default browser outline — we paint a focus-within accent
      // on the table scroller itself instead (see MessagesTable below),
      // which is more refined than a rectangle around the whole tab.
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
          return;
        }
        if (filtered.length === 0) return;
        if (e.key === "ArrowDown" || e.key === "j") {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(filtered.length - 1, Math.max(0, i + 1)));
        } else if (e.key === "ArrowUp" || e.key === "k") {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(0, i - 1));
        } else if (e.key === "Home") {
          e.preventDefault();
          setSelectedIndex(0);
        } else if (e.key === "End") {
          e.preventDefault();
          setSelectedIndex(filtered.length - 1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (selectedIndex >= 0) setDrawerMessage(filtered[selectedIndex]);
        } else if (e.key === "Escape") {
          if (drawerMessage) setDrawerMessage(null);
        }
      }}
    >
      {/* ─ Toolbar row 1: source + view controls ─────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Label
            htmlFor="part-sel"
            className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
          >
            Partition
          </Label>
          <select
            id="part-sel"
            value={partitionFilter}
            onChange={(e) => setPartitionFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs font-mono"
          >
            <option value="all">All</option>
            {partitions.map((p) => (
              <option key={p.partition} value={String(p.partition)}>
                {p.partition}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            id="from-beginning"
            size="sm"
            checked={fromBeginning}
            onCheckedChange={setFromBeginning}
          />
          <Label
            htmlFor="from-beginning"
            className="cursor-pointer text-xs font-normal text-muted-foreground"
          >
            From beginning
          </Label>
        </div>
        <Button
          size="sm"
          variant={live ? "default" : "outline"}
          onClick={() => setLive((l) => !l)}
          className={live ? "bg-orange-500 hover:bg-orange-500/90 text-white border-transparent" : ""}
        >
          <RadioTower className="size-3.5" />
          {live ? "Stop live tail" : "Live tail"}
          {live ? (
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider">
              <span className="size-1.5 rounded-full bg-white status-pulse" />
              LIVE
            </span>
          ) : null}
        </Button>
        {!live ? (
          <Button
            size="sm"
            variant="outline"
            onClick={loadMessages}
            disabled={loadingMessages}
          >
            {loadingMessages ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
            Fetch
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => { setMessages([]); receivedRef.current = []; }}>
            <Eraser className="size-3.5" />
            Clear
          </Button>
        )}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden />

        {/* View toggle */}
        <div className="inline-flex items-center rounded-md border border-border/60 bg-card/40 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("table")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
              viewMode === "table" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Rows3 className="size-3" />
            Table
          </button>
          <button
            type="button"
            onClick={() => setViewMode("lanes")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
              viewMode === "lanes" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Columns3 className="size-3" />
            Lanes
          </button>
        </div>

        {/* Jump to offset */}
        <Popover>
          <PopoverTrigger
            render={
              <Button size="sm" variant="outline" disabled={live}>
                <ChevronsRight className="size-3.5" />
                Jump
              </Button>
            }
          />
          <PopoverContent className="w-72 p-3" align="start">
            <div className="space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Jump to offset
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="jump-p" className="text-[10px]">Partition</Label>
                  <select
                    id="jump-p"
                    value={jumpPartition}
                    onChange={(e) => setJumpPartition(e.target.value)}
                    className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs font-mono"
                  >
                    {partitions.map((p) => (
                      <option key={p.partition} value={String(p.partition)}>
                        {p.partition}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="jump-o" className="text-[10px]">Offset</Label>
                  <Input
                    id="jump-o"
                    value={jumpOffset}
                    onChange={(e) => setJumpOffset(e.target.value)}
                    placeholder="0"
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>
              </div>
              <Button size="sm" onClick={jumpToOffset} disabled={jumpBusy} className="w-full">
                {jumpBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                Fetch 50 around offset
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          size="sm"
          variant="ghost"
          onClick={downloadJsonl}
          disabled={!messages || messages.length === 0}
          title="Download buffer as JSONL"
        >
          <Download className="size-3.5" />
          Export
        </Button>
      </div>

      {/* ─ Toolbar row 2: filters ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterInput
          icon={KeyRound}
          value={keyFilter}
          onChange={setKeyFilter}
          placeholder="Key contains…"
          width="w-40"
        />
        <FilterInput
          icon={Search}
          value={valueFilter}
          onChange={setValueFilter}
          placeholder="Value contains…"
          width="w-56"
        />
        <FilterInput
          icon={Headphones}
          value={headerFilter}
          onChange={setHeaderFilter}
          placeholder="Headers contain (k=v)…"
          width="w-56"
        />
        {(keyFilter || valueFilter || headerFilter) && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => { setKeyFilter(""); setValueFilter(""); setHeaderFilter(""); }}
          >
            <X className="size-3" />
            Clear
          </Button>
        )}
      </div>

      {/* ─ Throughput strip ───────────────────────────────────────────── */}
      <ThroughputStrip
        live={live}
        loading={loadingMessages}
        bufferSize={messages?.length ?? 0}
        filteredSize={filtered.length}
        rate={recentRate}
        history={throughput}
      />

      {/* ─ Body: table or lanes ───────────────────────────────────────── */}
      {loadingMessages ? (
        <EmptyState kind="loading" />
      ) : messages == null ? null : filtered.length === 0 ? (
        <EmptyState
          kind={
            messages.length === 0
              ? live
                ? "listening"
                : "no-results"
              : "no-match"
          }
          hasFilters={Boolean(keyFilter || valueFilter || headerFilter)}
        />
      ) : viewMode === "table" ? (
        <MessagesTable
          messages={filtered}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onOpenDrawer={setDrawerMessage}
          showKeyColumn={showKeyColumn}
          live={live}
        />
      ) : (
        <LanesView
          messages={filtered}
          partitions={partitions}
          onOpenDrawer={setDrawerMessage}
        />
      )}

      <MessageDetailSheet
        message={drawerMessage}
        topic={topic}
        onClose={() => setDrawerMessage(null)}
        onProduceSimilar={onProduceSimilar}
        base={base}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function FilterInput({
  icon: Icon,
  value,
  onChange,
  placeholder,
  width,
}: {
  icon: typeof Search;
  value: string;
  onChange: (s: string) => void;
  placeholder: string;
  width: string;
}) {
  return (
    <div className="relative">
      <Icon className="size-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("h-8 pl-7 text-xs", width)}
        spellCheck={false}
      />
    </div>
  );
}

function ThroughputStrip({
  live,
  loading,
  bufferSize,
  filteredSize,
  rate,
  history,
}: {
  live: boolean;
  loading: boolean;
  bufferSize: number;
  filteredSize: number;
  rate: number;
  history: number[];
}) {
  const rateStr =
    rate < 1 && rate > 0
      ? rate.toFixed(2)
      : rate >= 1000
        ? `${(rate / 1000).toFixed(1)}k`
        : Math.round(rate).toString();
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card/30 px-3 py-2 flex items-center gap-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full blur-3xl opacity-60 bg-orange-500/10"
      />
      {/* Status pill */}
      <div className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 rounded-full",
            live ? "bg-orange-500 status-pulse" : loading ? "bg-sky-500 status-pulse" : "bg-muted-foreground/40",
          )}
        />
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {live ? "Live tail" : loading ? "Fetching" : "Idle"}
        </span>
      </div>
      <span className="h-4 w-px bg-border" aria-hidden />
      {/* Rate + sparkline */}
      <div className="flex items-baseline gap-2">
        <span
          className="text-base font-semibold tabular-nums leading-none"
          style={{ fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace" }}
        >
          {live || rate > 0 ? rateStr : "—"}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          msg/s
        </span>
      </div>
      <Sparkline
        values={history}
        width={140}
        height={20}
        tone="neutral"
        className="text-orange-500"
      />
      <span className="h-4 w-px bg-border" aria-hidden />
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground tabular-nums">
        {filteredSize}
        {filteredSize !== bufferSize ? <span className="opacity-50"> / {bufferSize}</span> : null}{" "}
        buffered
      </div>
      <div className="ml-auto text-[10px] font-mono text-muted-foreground tabular-nums hidden md:block">
        ↑/↓ navigate · enter opens · esc closes
      </div>
    </div>
  );
}

function MessagesTable({
  messages,
  selectedIndex,
  onSelect,
  onOpenDrawer,
  showKeyColumn,
  live,
}: {
  messages: KafkaMessage[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  onOpenDrawer: (m: KafkaMessage) => void;
  showKeyColumn: boolean;
  live: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false); // hover-pause for live tail

  // Auto-stick to top in live tail (newest is at index 0). Skip if paused
  // or if the user scrolled away from the top.
  useEffect(() => {
    if (!live) return;
    if (paused) return;
    const el = scrollerRef.current;
    if (!el) return;
    if (el.scrollTop > 24) return; // user has scrolled away
    el.scrollTop = 0;
  }, [messages, live, paused]);

  // Scroll the focused row into view when keyboard nav moves.
  useEffect(() => {
    if (selectedIndex < 0) return;
    const el = scrollerRef.current?.querySelector<HTMLTableRowElement>(
      `tr[data-row="${selectedIndex}"]`,
    );
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  return (
    <div
      ref={scrollerRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // outline-none drops the browser's default focus rect that
      // overflow-auto containers can show when keys flow through them.
      // The amber-tinted selected row is the focus indicator instead.
      className="relative rounded-lg border border-border/60 overflow-auto max-h-[62vh] outline-none"
    >
      {live && paused ? (
        <div className="sticky top-0 z-20 bg-amber-500/10 border-b border-amber-500/30 px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <Pause className="size-3" />
          Paused — move pointer away to resume
        </div>
      ) : null}
      <table className="w-full text-xs font-mono">
        <thead className="bg-muted/50 sticky top-0 z-10">
          <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <th className="px-3 py-2 text-left font-semibold w-10">P</th>
            <th className="px-3 py-2 text-left font-semibold w-24">Offset</th>
            <th className="px-3 py-2 text-left font-semibold w-32">Time</th>
            {showKeyColumn ? (
              <th className="px-3 py-2 text-left font-semibold w-[18%]">Key</th>
            ) : null}
            <th className="px-3 py-2 text-left font-semibold w-16">Type</th>
            <th className="px-3 py-2 text-left font-semibold">Value</th>
            <th className="px-3 py-2 text-left font-semibold w-12">Hdrs</th>
          </tr>
        </thead>
        <tbody>
          {messages.map((m, i) => {
            const dv = displayValue(m);
            const type = m.valueDecoded?.schemaType ?? detectValueType(m.value);
            const headerCount = Object.keys(m.headers).length;
            const isSelected = i === selectedIndex;
            return (
              <tr
                key={`${m.partition}-${m.offset}-${i}`}
                data-row={i}
                onClick={() => { onSelect(i); onOpenDrawer(m); }}
                onMouseEnter={() => onSelect(i)}
                className={cn(
                  "border-t border-border/30 cursor-pointer transition-colors",
                  isSelected ? "bg-brand/[0.08]" : "hover:bg-muted/40",
                )}
              >
                <td className="px-3 py-1 align-top">
                  <PartitionBadge partition={m.partition} />
                </td>
                <td className="px-3 py-1 align-top tabular-nums text-muted-foreground">
                  {m.offset}
                </td>
                <td className="px-3 py-1 align-top text-muted-foreground tabular-nums whitespace-nowrap">
                  {formatTimeShort(m.timestamp)}
                </td>
                {showKeyColumn ? (
                  <td className="px-3 py-1 align-top truncate max-w-[20ch]">
                    {m.key ?? <span className="text-muted-foreground/40">—</span>}
                  </td>
                ) : null}
                <td className="px-3 py-1 align-top">
                  {m.valueDecoded ? (
                    <SchemaChip d={m.valueDecoded} />
                  ) : (
                    <ValueTypeChip type={type as ValueType} />
                  )}
                </td>
                <td className="px-3 py-1 align-top max-w-[60ch] truncate">
                  {dv ?? <span className="text-muted-foreground/40">null</span>}
                </td>
                <td className="px-3 py-1 align-top">
                  {headerCount > 0 ? (
                    <span
                      title={Object.entries(m.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}
                      className="inline-flex items-center justify-center min-w-[20px] rounded px-1 py-0 text-[9px] font-mono bg-muted/60 text-foreground/70 border border-border/60 cursor-help"
                    >
                      H{headerCount}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/30">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LanesView({
  messages,
  partitions,
  onOpenDrawer,
}: {
  messages: KafkaMessage[];
  partitions: PartitionInfo[];
  onOpenDrawer: (m: KafkaMessage) => void;
}) {
  // Group messages by partition. Only render lanes for partitions that
  // actually contain visible messages.
  const grouped = useMemo(() => {
    const m = new Map<number, KafkaMessage[]>();
    for (const msg of messages) {
      const arr = m.get(msg.partition) ?? [];
      arr.push(msg);
      m.set(msg.partition, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [messages]);
  void partitions;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-2 max-h-[62vh] overflow-auto">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${grouped.length}, minmax(220px, 1fr))` }}>
        {grouped.map(([p, msgs]) => {
          const tone = partitionTone(p);
          return (
            <div key={p} className="space-y-1.5">
              <header
                className={cn(
                  "sticky top-0 z-10 flex items-center justify-between rounded-md border px-2 py-1",
                  "backdrop-blur bg-card/80",
                  tone.border,
                )}
              >
                <div className="inline-flex items-center gap-1.5">
                  <PartitionBadge partition={p} />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    {msgs.length} msg
                  </span>
                </div>
              </header>
              {msgs.map((m, i) => {
                const dv = displayValue(m);
                const type = detectValueType(m.value);
                return (
                  <button
                    key={`${m.offset}-${i}`}
                    type="button"
                    onClick={() => onOpenDrawer(m)}
                    className={cn(
                      "block w-full text-left rounded-md border bg-card/50 hover:bg-card/80",
                      "px-2 py-1.5 transition-colors",
                      tone.border,
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                        @{m.offset}
                      </span>
                      {m.valueDecoded ? (
                        <SchemaChip d={m.valueDecoded} />
                      ) : (
                        <ValueTypeChip type={type} />
                      )}
                    </div>
                    {m.key ? (
                      <div className="text-[10px] font-mono text-muted-foreground truncate">
                        {m.key}
                      </div>
                    ) : null}
                    <div className="text-xs font-mono break-words line-clamp-3">
                      {dv ?? <span className="text-muted-foreground/40">null</span>}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[9px] font-mono text-muted-foreground tabular-nums">
                      <span>{formatTimeShort(m.timestamp)}</span>
                      {Object.keys(m.headers).length > 0 ? (
                        <span>H{Object.keys(m.headers).length}</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({
  kind,
  hasFilters,
}: {
  kind: "loading" | "listening" | "no-results" | "no-match";
  hasFilters?: boolean;
}) {
  if (kind === "loading") {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-10 text-center">
        <Loader2 className="size-5 mx-auto mb-3 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Consuming up to 100 messages…</p>
      </div>
    );
  }
  if (kind === "listening") {
    return (
      <div className="rounded-xl border border-dashed border-orange-500/40 bg-orange-500/[0.04] p-10 text-center">
        <RadioTower className="size-5 mx-auto mb-3 text-orange-500 status-pulse" />
        <h3
          className="text-lg font-semibold"
          style={{ fontFamily: "var(--font-instrument-serif), Georgia, serif" }}
        >
          Listening for messages
        </h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          The live tail is open. New messages will stream in here as soon as a
          producer writes to this topic.
        </p>
      </div>
    );
  }
  if (kind === "no-results") {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-10 text-center">
        <Eye className="size-5 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No messages within timeout. Try toggling{" "}
          <span className="font-mono text-xs px-1 py-0.5 rounded bg-muted">
            From beginning
          </span>
          {" "}or fetch from a different partition.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-8 text-center">
      <p className="text-sm text-muted-foreground">
        No messages match the current filter{hasFilters ? "s" : ""}.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Detail drawer — moved into this file so the messages tab is fully
// self-contained, with new features: syntax-highlighted JSON, copy as
// JSON / curl / kcat, Produce similar.
// ─────────────────────────────────────────────────────────────────────────

function MessageDetailSheet({
  message,
  topic,
  onClose,
  onProduceSimilar,
  base,
}: {
  message: KafkaMessage | null;
  topic: string;
  onClose: () => void;
  onProduceSimilar?: (template: ProduceTemplate) => void;
  base: string;
}) {
  // Partition-colored tone for the header accent rail + glow.
  const tone = message ? partitionTone(message.partition) : null;
  return (
    <Sheet
      open={Boolean(message)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full data-[side=right]:sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        {/* Specimen-tag header. Three zones in one row:
              ┃ TOPIC / topic name / mono tech-line     [Actions] [X]
            The partition-colored rail on the left grounds the whole
            header in that partition's identity. */}
        <SheetHeader className="relative border-b border-border/60 px-5 pt-4 pb-3 gap-0">
          {/* Soft partition-tinted glow at the right edge of the header */}
          {tone ? (
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute -right-12 -top-10 size-32 rounded-full blur-3xl opacity-40",
                tone.dot,
              )}
            />
          ) : null}

          <div className="relative flex items-start gap-3">
            {/* Partition accent rail */}
            {tone ? (
              <div
                aria-hidden
                className={cn("w-[3px] self-stretch rounded-full", tone.dot)}
              />
            ) : null}

            {/* Title block */}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
                Topic
              </div>
              <SheetTitle
                className="text-2xl leading-tight font-semibold truncate"
                style={{
                  fontFamily:
                    "var(--font-instrument-serif), Georgia, serif",
                }}
              >
                {topic}
              </SheetTitle>
              {message ? (
                <div className="mt-1.5 flex items-center gap-2 text-[11px] font-mono text-muted-foreground tabular-nums flex-wrap">
                  <PartitionBadge partition={message.partition} size="md" />
                  <span>@{message.offset}</span>
                  <span className="text-border" aria-hidden>·</span>
                  <span>{formatTimeShort(message.timestamp)}</span>
                </div>
              ) : null}
            </div>

            {/* Right cluster — Actions + close. Same button height, equal
                spacing, sits inside the flow so it never overlaps anything. */}
            {message ? (
              <div className="flex items-center gap-1 shrink-0">
                <DrawerActions
                  message={message}
                  topic={topic}
                  base={base}
                  onProduceSimilar={(t) => {
                    onProduceSimilar?.(t);
                    onClose();
                  }}
                />
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close drawer"
                  title="Close (esc)"
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-md",
                    "text-muted-foreground transition-colors",
                    "hover:text-rose-600 hover:bg-rose-500/10",
                    "dark:hover:text-rose-300",
                  )}
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : null}
          </div>
        </SheetHeader>
        {message ? (
          <div className="flex-1 min-h-0 overflow-auto p-5 space-y-5">
            <MetaRow label="Timestamp">
              <span className="font-mono text-xs">
                {new Date(Number(message.timestamp)).toISOString()}
                <span className="ml-2 text-muted-foreground">
                  ({relativeFromTimestamp(message.timestamp)})
                </span>
              </span>
            </MetaRow>
            <MetaRow label="Partition">
              <span className="font-mono text-xs">{message.partition}</span>
            </MetaRow>
            <MetaRow label="Offset">
              <span className="font-mono text-xs">{message.offset}</span>
            </MetaRow>

            <DetailBlock label="Key" content={message.key} />
            {message.valueDecoded ? (
              <>
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                  Decoded by Schema Registry
                  <SchemaChip d={message.valueDecoded} />
                </div>
                <DetailBlock
                  label="Decoded"
                  content={
                    message.valueDecoded.json
                      ? prettyPrintJson(message.valueDecoded.json)
                      : message.valueDecoded.note ?? "(no decoded payload)"
                  }
                />
                <details className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                  <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    raw bytes
                  </summary>
                  <DetailBlock label="Raw" content={message.value} />
                </details>
              </>
            ) : (
              <DetailBlock label="Value" content={message.value} />
            )}

            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Headers
              </p>
              {Object.keys(message.headers).length === 0 ? (
                <p className="text-xs text-muted-foreground">No headers.</p>
              ) : (
                <div className="rounded-md border border-border/60 overflow-hidden">
                  <table className="w-full text-xs font-mono">
                    <tbody>
                      {Object.entries(message.headers).map(([k, v]) => (
                        <tr key={k} className="border-b border-border/40 last:border-b-0">
                          <td className="px-3 py-1.5 text-muted-foreground align-top w-1/3 break-all">
                            {k}
                          </td>
                          <td className="px-3 py-1.5 break-all">{v || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DrawerActions({
  message,
  topic,
  base,
  onProduceSimilar,
}: {
  message: KafkaMessage;
  topic: string;
  base: string;
  onProduceSimilar: (template: ProduceTemplate) => void;
}) {
  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${label} to clipboard`);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };
  const buildCurl = (): string => {
    const url = `${typeof window !== "undefined" ? window.location.origin : ""}${base}/messages`;
    const body = JSON.stringify({
      key: message.key,
      value: message.value,
      headers: message.headers,
    });
    return [
      `curl ${shellQuote(url)}`,
      `  -H 'content-type: application/json'`,
      `  --data ${shellQuote(body)}`,
    ].join(" \\\n");
  };
  const buildKcat = (): string => {
    const headerArgs = Object.entries(message.headers)
      .map(([k, v]) => `-H ${shellQuote(`${k}=${v}`)}`)
      .join(" ");
    const keyArg = message.key ? `-k ${shellQuote(message.key)}` : "";
    return `echo ${shellQuote(message.value ?? "")} | kcat -b BROKER -P -t ${shellQuote(topic)} ${keyArg} ${headerArgs}`.trim();
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline", size: "xs" }))}
            aria-label="Message actions"
          >
            <MoreHorizontal className="size-3" />
            Actions
          </button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workflow</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() =>
              onProduceSimilar({
                key: message.key ?? undefined,
                value: message.value ?? "",
                headers: message.headers,
              })
            }
          >
            <Sparkles className="size-3.5" />
            Produce similar
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Copy as</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => copy("JSON", JSON.stringify(message, null, 2))}
          >
            <FileJson className="size-3.5" />
            JSON
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => copy("curl", buildCurl())}>
            <Terminal className="size-3.5" />
            curl
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => copy("kcat", buildKcat())}>
            <Send className="size-3.5" />
            kcat
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              copy(
                "offset reference",
                `${topic}[${message.partition}]@${message.offset}`,
              )
            }
          >
            <ArrowDownToLine className="size-3.5" />
            Topic[part]@offset
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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

function DetailBlock({
  label,
  content,
}: {
  label: string;
  content: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const type = useMemo(() => detectValueType(content), [content]);
  const pretty = useMemo(() => prettyPrintJson(content), [content]);
  const highlighted = useMemo(
    () => (type === "json" ? highlightJson(pretty) : null),
    [type, pretty],
  );
  const onCopy = async () => {
    if (content == null) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground inline-flex items-center gap-2">
          {label}
          {content != null ? <ValueTypeChip type={type} /> : null}
        </p>
        {content != null ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={onCopy}
            className="h-6 px-2"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "copied" : "copy"}
          </Button>
        ) : null}
      </div>
      {content == null ? (
        <p className="text-xs text-muted-foreground">null</p>
      ) : highlighted ? (
        <pre
          className="rounded-md border border-border/60 bg-zinc-950 text-zinc-100 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[40vh] overflow-auto"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <pre className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[40vh] overflow-auto">
          {pretty}
        </pre>
      )}
    </div>
  );
}
