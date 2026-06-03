"use client";
import { useEffect, useState } from "react";
import type { ConnectionRecord } from "@/lib/connections/types";

/**
 * Fetches the connection list. Pass a `reloadToken` that changes when you want
 * a refetch (e.g. the palette's `open` flag) so the list stays current without
 * a page reload. Previous results are kept while a refetch is in flight.
 */
export function useConnections(reloadToken?: unknown): {
  connections: ConnectionRecord[];
  fetched: boolean;
} {
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
  }, [reloadToken]);
  return { connections, fetched };
}
