"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Loader2, Search, StopCircle, X } from "lucide-react";
import type { KafkaMessage } from "./messages-tab";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  topic: string;
  onPick: (m: KafkaMessage) => void;
}

interface SearchPredicate {
  key?: string;
  jsonPath?: string;
  jsonPathEquals?: string;
  valueContains?: string;
  regex?: boolean;
  headers?: Record<string, string>;
}

interface SearchMatchPayload {
  kind: "match";
  match: { message: KafkaMessage; cursor: { partition: number; offset: string } };
}
interface SearchProgress {
  kind: "progress";
  scanned: number;
  matched: number;
}
interface SearchDone {
  kind: "done";
  scanned: number;
  matched: number;
  truncated: boolean;
}

type Phase = "idle" | "scanning" | "done" | "error";

const STORAGE_KEY = (cid: string, topic: string) =>
  `baklava:kafka:search:${cid}:${topic}`;

interface SavedFilter {
  name: string;
  predicate: SearchPredicate;
  windowMinutes: number;
}

function loadSaved(cid: string, topic: string): SavedFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY(cid, topic));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSaved(cid: string, topic: string, list: SavedFilter[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY(cid, topic), JSON.stringify(list));
  } catch {
    /* full or disabled */
  }
}

export function TopicSearchSheet({
  open,
  onOpenChange,
  connectionId,
  topic,
  onPick,
}: Props) {
  const [keyQ, setKeyQ] = useState("");
  const [valueQ, setValueQ] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [jsonPath, setJsonPath] = useState("");
  const [jsonEq, setJsonEq] = useState("");
  const [headersStr, setHeadersStr] = useState("");
  const [windowMinutes, setWindowMinutes] = useState(60);

  const [phase, setPhase] = useState<Phase>("idle");
  const [scanned, setScanned] = useState(0);
  const [results, setResults] = useState<KafkaMessage[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) setSaved(loadSaved(connectionId, topic));
  }, [open, connectionId, topic]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const run = useCallback(async () => {
    const predicate: SearchPredicate = {};
    if (keyQ.trim()) predicate.key = keyQ.trim();
    if (valueQ.trim()) {
      predicate.valueContains = valueQ.trim();
      if (isRegex) predicate.regex = true;
    }
    if (jsonPath.trim()) {
      predicate.jsonPath = jsonPath.trim();
      if (jsonEq.trim()) predicate.jsonPathEquals = jsonEq.trim();
    }
    if (headersStr.trim()) {
      const out: Record<string, string> = {};
      for (const pair of headersStr.split(",")) {
        const [k, v] = pair.split("=");
        if (k && v) out[k.trim()] = v.trim();
      }
      if (Object.keys(out).length > 0) predicate.headers = out;
    }

    setPhase("scanning");
    setScanned(0);
    setResults([]);
    setTruncated(false);
    setError(null);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // TODO: migrate to shared SseFrameParser (@/lib/sse-client)
      // (this consumer dispatches on ev.kind inside the JSON payload, not on
      // SSE event names, so it is not a mechanical drop-in for SseFrameParser)
      // Stream Server-Sent Events manually via fetch + reader because we
      // need POST (EventSource only supports GET).
      const res = await fetch(
        `/api/kafka/${connectionId}/topics/${encodeURIComponent(topic)}/search`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            predicate,
            matchLimit: 200,
            scanCap: 100_000,
            startTimestamp:
              windowMinutes > 0 ? Date.now() - windowMinutes * 60_000 : undefined,
          }),
          signal: ac.signal,
        },
      );
      if (!res.body) {
        setError("No response body");
        setPhase("error");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE frames are separated by \n\n.
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const ev = JSON.parse(dataLine.slice(6)) as
              | SearchProgress
              | SearchMatchPayload
              | SearchDone
              | { kind: "error"; message: string };
            if (ev.kind === "progress") {
              setScanned(ev.scanned);
            } else if (ev.kind === "match") {
              setResults((r) => [...r, ev.match.message]);
              setScanned((s) => s + 0); // forced update
            } else if (ev.kind === "done") {
              setScanned(ev.scanned);
              setTruncated(ev.truncated);
              setPhase("done");
            } else if (ev.kind === "error") {
              setError(ev.message);
              setPhase("error");
            }
          } catch {
            /* skip malformed frame */
          }
        }
      }
      if (phase !== "error" && phase !== "done") setPhase("done");
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") {
        setPhase("done");
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    } finally {
      abortRef.current = null;
    }
  }, [
    connectionId,
    topic,
    keyQ,
    valueQ,
    isRegex,
    jsonPath,
    jsonEq,
    headersStr,
    windowMinutes,
    phase,
  ]);

  const saveCurrent = useCallback(() => {
    const name = window.prompt("Name this filter");
    if (!name) return;
    const predicate: SearchPredicate = {};
    if (keyQ.trim()) predicate.key = keyQ.trim();
    if (valueQ.trim()) {
      predicate.valueContains = valueQ.trim();
      if (isRegex) predicate.regex = true;
    }
    if (jsonPath.trim()) {
      predicate.jsonPath = jsonPath.trim();
      if (jsonEq.trim()) predicate.jsonPathEquals = jsonEq.trim();
    }
    const next = [
      ...saved.filter((s) => s.name !== name),
      { name, predicate, windowMinutes },
    ];
    saveSaved(connectionId, topic, next);
    setSaved(next);
  }, [
    connectionId,
    topic,
    keyQ,
    valueQ,
    isRegex,
    jsonPath,
    jsonEq,
    windowMinutes,
    saved,
  ]);

  const loadSavedFilter = useCallback((f: SavedFilter) => {
    setKeyQ(f.predicate.key ?? "");
    setValueQ(f.predicate.valueContains ?? "");
    setIsRegex(Boolean(f.predicate.regex));
    setJsonPath(f.predicate.jsonPath ?? "");
    setJsonEq(f.predicate.jsonPathEquals ?? "");
    setWindowMinutes(f.windowMinutes);
    setHeadersStr(
      f.predicate.headers
        ? Object.entries(f.predicate.headers)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
        : "",
    );
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Search className="size-4" />
            Search topic
          </SheetTitle>
          <SheetDescription>
            Server-side scan from <span className="font-mono">now − {windowMinutes}m</span>.
            Caps at 200 matches or 100 000 messages scanned.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-4 space-y-3 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Key contains">
              <Input
                value={keyQ}
                onChange={(e) => setKeyQ(e.target.value)}
                placeholder="order-42"
              />
            </Field>
            <Field
              label={`Value ${isRegex ? "matches regex" : "contains"}`}
              hint={
                <button
                  type="button"
                  onClick={() => setIsRegex(!isRegex)}
                  className="text-[10px] font-mono uppercase tracking-wider hover:text-foreground text-muted-foreground"
                >
                  {isRegex ? "regex on" : "regex off"}
                </button>
              }
            >
              <Input
                value={valueQ}
                onChange={(e) => setValueQ(e.target.value)}
                placeholder={isRegex ? "^\\{.*foo.*\\}$" : "substring"}
              />
            </Field>
            <Field label="JSON path">
              <Input
                value={jsonPath}
                onChange={(e) => setJsonPath(e.target.value)}
                placeholder="$.user.id"
                spellCheck={false}
              />
            </Field>
            <Field label="JSON path equals">
              <Input
                value={jsonEq}
                onChange={(e) => setJsonEq(e.target.value)}
                placeholder="42"
              />
            </Field>
            <Field label="Headers (k=v, k=v)" wide>
              <Input
                value={headersStr}
                onChange={(e) => setHeadersStr(e.target.value)}
                placeholder="trace-id=abc, env=prod"
              />
            </Field>
            <Field label="Look-back (minutes)">
              <Input
                type="number"
                min={1}
                max={1440}
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(Number(e.target.value) || 60)}
              />
            </Field>
          </div>

          <div className="flex items-center gap-2 pt-2">
            {phase === "scanning" ? (
              <Button variant="destructive" size="sm" onClick={stop} className="gap-1.5">
                <StopCircle className="size-3.5" />
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={run} className="gap-1.5">
                <Search className="size-3.5" />
                Scan
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={saveCurrent}>
              Save filter
            </Button>
            <div className="ml-auto text-[10px] font-mono text-muted-foreground tabular-nums">
              {phase === "scanning" ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" />
                  scanning … {scanned.toLocaleString()} examined ·{" "}
                  {results.length} matched
                </span>
              ) : phase === "done" ? (
                <span>
                  scanned {scanned.toLocaleString()} · {results.length} matched
                  {truncated ? " · (truncated)" : ""}
                </span>
              ) : phase === "error" && error ? (
                <span className="text-rose-500">{error}</span>
              ) : null}
            </div>
          </div>

          {saved.length > 0 ? (
            <div className="flex items-center gap-1 flex-wrap pt-1 border-t border-border/40 pt-2">
              <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mr-1">
                Saved
              </span>
              {saved.map((f) => (
                <span
                  key={f.name}
                  className="inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-card/60 text-[11px] font-mono pl-2 pr-0.5 py-0.5"
                >
                  <button
                    type="button"
                    onClick={() => loadSavedFilter(f)}
                    className="hover:text-foreground text-muted-foreground"
                  >
                    {f.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = saved.filter((s) => s.name !== f.name);
                      saveSaved(connectionId, topic, next);
                      setSaved(next);
                    }}
                    className="size-4 grid place-items-center text-muted-foreground hover:text-rose-500"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="border-t border-border/40 pt-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
                Matches
              </div>
              {results.map((m, i) => (
                <button
                  key={`${m.partition}-${m.offset}-${i}`}
                  type="button"
                  onClick={() => {
                    onPick(m);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "w-full text-left rounded-md border border-border/40 bg-card/40 hover:bg-muted/40 transition-colors px-2 py-1.5",
                  )}
                >
                  <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground tabular-nums">
                    <span>p{m.partition}</span>
                    <span>@{m.offset}</span>
                    <span>{new Date(Number(m.timestamp)).toISOString().slice(11, 23)}</span>
                  </div>
                  {m.key ? (
                    <div className="text-[11px] font-mono text-muted-foreground truncate">
                      {m.key}
                    </div>
                  ) : null}
                  <div className="text-xs font-mono break-words line-clamp-2">
                    {m.valueDecoded?.json ?? m.value ?? <span className="text-muted-foreground/40">null</span>}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  children,
  hint,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2 space-y-1" : "space-y-1"}>
      <div className="flex items-center justify-between">
        <Label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
          {label}
        </Label>
        {hint}
      </div>
      {children}
    </div>
  );
}
