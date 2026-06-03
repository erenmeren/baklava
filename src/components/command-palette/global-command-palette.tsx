"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as Icons from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useConnections } from "@/lib/command-palette/use-connections";
import {
  OBJECT_PROVIDERS,
  type PaletteObject,
} from "@/lib/command-palette/object-providers";
import { getRecent } from "@/lib/command-palette/recent";
import { sectionsFor } from "@/lib/command-palette/sections";
import { workspaceHref } from "@/lib/connections/first-page";
import { onOpenCommandPalette } from "@/lib/command-palette/palette-events";
import { useTheme } from "@/components/theme-provider";
import type { ConnectionRecord, TechId } from "@/lib/connections/types";
import { connectionSummaries } from "@/lib/connections/summaries";

function Icon({ name, className }: { name: string; className?: string }) {
  const C = (
    Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>
  )[name];
  return C ? <C className={className ?? "size-3.5"} /> : null;
}

function currentConnId(
  pathname: string | null
): { tech: TechId; id: string } | null {
  const m = pathname?.match(
    /^\/(docker|postgres|mysql|kafka|sqlserver|kubernetes|redis|mongo|r2|minio|s3)\/([^/]+)/
  );
  return m ? { tech: m[1] as TechId, id: m[2] } : null;
}

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { connections } = useConnections();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => onOpenCommandPalette(() => setOpen(true)), []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const recent = useMemo(() => {
    const order = getRecent();
    const rank = (c: ConnectionRecord) => {
      const i = order.indexOf(c.id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...connections].sort(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, open]); // re-read recents when reopened

  const here = currentConnId(pathname);
  const sections = here ? sectionsFor(here.tech) : [];

  // "In this connection" object search — debounced calls to the per-tech
  // provider. Results are server-filtered by `query`; each item's `value`
  // includes its label so cmdk's own filter keeps them visible.
  const [query, setQuery] = useState("");
  const [objects, setObjects] = useState<PaletteObject[]>([]);
  useEffect(() => {
    if (!here) {
      setObjects([]);
      return;
    }
    const provider = OBJECT_PROVIDERS[here.tech];
    if (!provider || !open) {
      setObjects([]);
      return;
    }
    const t = setTimeout(() => {
      void provider(here.id, query, { pathname: pathname ?? "" }).then(
        setObjects,
      );
    }, 150);
    return () => clearTimeout(t);
  }, [here, query, open, pathname]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Jump to a connection, section, or action…"
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {objects.length > 0 ? (
          <CommandGroup heading="In this connection">
            {objects.map((o) => (
              <CommandItem
                key={`${o.href}#${o.label}`}
                value={`obj ${o.label} ${o.sublabel ?? ""}`}
                onSelect={() => go(o.href)}
              >
                <Icon name={o.icon ?? "Circle"} />
                <span className="flex-1 truncate">{o.label}</span>
                {o.sublabel ? (
                  <span className="text-[11px] text-muted-foreground truncate max-w-[40%]">
                    {o.sublabel}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {here && sections.length > 0 ? (
          <CommandGroup heading="Go to">
            {sections.map((s) => (
              <CommandItem
                key={s.seg || "root"}
                value={`go ${s.label}`}
                onSelect={() =>
                  go(
                    s.seg
                      ? `/${here.tech}/${here.id}/${s.seg}`
                      : `/${here.tech}/${here.id}`
                  )
                }
              >
                <Icon name={s.icon} />
                <span>{s.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandGroup heading="Connections">
          {recent.map((c) => (
            <CommandItem
              key={c.id}
              value={`conn ${c.name} ${c.tech}`}
              onSelect={() => go(workspaceHref(c.tech, c.id))}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/icons/${c.tech}.svg`}
                alt=""
                className="size-3.5 dark:invert opacity-80"
              />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-[11px] text-muted-foreground truncate max-w-[40%]">
                {connectionSummaries[c.tech]?.(c) ?? c.tech}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Actions">
          <CommandItem value="action new connection" onSelect={() => go("/")}>
            <Icon name="Plus" />
            <span>New connection…</span>
          </CommandItem>
          <CommandItem value="action home" onSelect={() => go("/")}>
            <Icon name="Home" />
            <span>Go to home</span>
          </CommandItem>
          <CommandItem
            value="action toggle theme"
            onSelect={() => {
              setOpen(false);
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
            }}
          >
            <Icon name="SunMoon" />
            <span>Toggle theme</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
