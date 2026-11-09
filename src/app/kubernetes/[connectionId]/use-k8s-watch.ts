"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { K8S_RESOURCES } from "@/lib/kubernetes/commands";
import {
  applyDelete,
  applyReset,
  applyUpsert,
  type KeyedRow,
  type LiveList,
  type WatchReset,
} from "@/lib/kubernetes/watch-merge";

export type WatchStatus = "off" | "connecting" | "live" | "reconnecting";

const MAX_BACKOFF_MS = 30_000;

/**
 * Keep a server-rendered list current through the watch SSE route. Which list
 * this is comes from the URL (`/kubernetes/<id>/<resource>`), so the table
 * stays generic and no view has to say what it shows. A new server render
 * (navigation, mutation refresh, the periodic usage refresh) replaces the rows.
 */
export function useK8sWatch<T extends KeyedRow>(
  connectionId: string,
  namespace: string,
  initial: { rows: T[]; truncated: boolean; remaining: number | null },
): LiveList<T> & { status: WatchStatus } {
  const pathname = usePathname();
  const segment = pathname?.split("/")[3];
  const resource = pathname?.split("/").length === 4
    && K8S_RESOURCES.some((r) => r.path === segment) ? segment : null;

  const [list, setList] = useState<LiveList<T>>(() => ({
    ...initial,
    keep: [],
    newestFirst: false,
  }));
  const [status, setStatus] = useState<WatchStatus>("off");
  const sourceRef = useRef<EventSource | null>(null);

  // Fresh server rows win — they carry usage the watch never sees.
  const { rows, truncated, remaining } = initial;
  useEffect(() => {
    setList((s) => ({ ...s, rows, truncated, remaining }));
  }, [rows, truncated, remaining]);

  useEffect(() => {
    if (!resource || typeof EventSource === "undefined") return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const qs = namespace ? `?ns=${encodeURIComponent(namespace)}` : "";
    const url = `/api/kubernetes/${encodeURIComponent(connectionId)}/watch/${resource}${qs}`;

    const connect = () => {
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const es = new EventSource(url);
      sourceRef.current = es;
      es.addEventListener("reset", (e) => {
        attempt = 0;
        setStatus("live");
        const payload = JSON.parse((e as MessageEvent).data) as WatchReset<T>;
        setList((s) => applyReset(s, payload));
      });
      es.addEventListener("upsert", (e) => {
        const row = JSON.parse((e as MessageEvent).data) as T;
        setList((s) => applyUpsert(s, row));
      });
      es.addEventListener("delete", (e) => {
        const { key } = JSON.parse((e as MessageEvent).data) as { key: string };
        setList((s) => applyDelete(s, key));
      });
      // Both the server's `error` event and a dropped connection land here.
      // Native EventSource retry has no backoff, so close and retry ourselves.
      es.addEventListener("error", () => {
        es.close();
        if (stopped) return;
        setStatus("reconnecting");
        const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        attempt += 1;
        timer = setTimeout(connect, delay);
      });
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      sourceRef.current?.close();
      setStatus("off");
    };
  }, [resource, connectionId, namespace]);

  useEffect(() => () => sourceRef.current?.close(), []);

  return { ...list, status };
}
