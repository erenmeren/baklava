"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CommandPalette } from "@/components/postgres/command-palette";

interface Props {
  connectionId: string;
  defaultDatabase: string;
}

/**
 * Mounts the command palette globally for the postgres workspace.
 *
 * - Cmd/Ctrl+K toggles the palette
 * - Reads the current database from the URL when present (so search
 *   defaults to the DB you're actively looking at), falls back to the
 *   connection's default database otherwise
 * - Fetches the list of databases once so the palette can offer a
 *   widen-to-all-DBs mode
 */
export function CommandPaletteHost({ connectionId, defaultDatabase }: Props) {
  const [open, setOpen] = useState(false);
  const [allDatabases, setAllDatabases] = useState<string[]>([]);
  const pathname = usePathname();

  // Extract /databases/<name>/... from the URL when present.
  const currentDatabase = (() => {
    const m =
      pathname?.match(/\/postgres\/[^/]+\/databases\/([^/]+)/) ?? null;
    return m ? decodeURIComponent(m[1]) : defaultDatabase;
  })();

  const toggle = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isModK =
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isModK) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Pre-fetch the database list once. Tiny payload, no per-DB cost.
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/postgres/${connectionId}/databases`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          databases?: Array<{ name: string }>;
        };
        if (!cancelled && data.databases) {
          setAllDatabases(data.databases.map((d) => d.name));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  return (
    <CommandPalette
      connectionId={connectionId}
      currentDatabase={currentDatabase}
      allDatabases={allDatabases.length > 0 ? allDatabases : [defaultDatabase]}
      open={open}
      onOpenChange={setOpen}
    />
  );
}
