"use client";
import { useEffect, useState } from "react";
import type { ConnectionRecord } from "@/lib/connections/types";

export function useConnections(): { connections: ConnectionRecord[]; fetched: boolean } {
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [fetched, setFetched] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/connections", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { connections: [] }))
      .then((d: { connections?: ConnectionRecord[] }) => {
        if (!cancelled) { setConnections(d.connections ?? []); setFetched(true); }
      })
      .catch(() => { if (!cancelled) setFetched(true); });
    return () => { cancelled = true; };
  }, []);
  return { connections, fetched };
}
