# Global ⌘K Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One app-wide ⌘K palette to fuzzy-jump to any connection, any section of the current connection, global actions, and (for the 4 techs that already have it) objects in the current connection.

**Architecture:** A client palette mounted once in the root layout owns ⌘K everywhere. Static `TECH_SECTIONS` data drives the "Go to" group; a shared `useConnections` hook drives the connection group; object search for postgres/mysql/sqlserver/kubernetes is folded in via an `OBJECT_PROVIDERS` adapter (their existing per-tech palette hosts are removed). A header pill opens the same palette.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, cmdk (`@/components/ui/command.tsx`), vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-02-global-command-palette-design.md`
**Authoritative section segments (from route dirs):** docker[containers,images,networks,volumes,stacks,registries,system,events]; postgres[databases,activity,locks,roles,extensions,diagnostics]; mysql[databases,processlist]; sqlserver[databases,activity,locks,queries,query-store,query,backup,indexes,security]; kubernetes[pods,deployments,services,configmaps,secrets,namespaces]; redis[keys,cli,pubsub,streams,monitor,cluster,acl,info]; mongo[databases,current-op,server-status,repl-status]; r2/minio/s3[overview(""),buckets].

**Branch:** create `feat/command-palette` off `main` before Task 1.

---

## Phase 1 — Foundation (shared data + hooks)

### Task 1: Extract `FIRST_PAGE` to a shared module

**Files:** Create `src/lib/connections/first-page.ts`; Modify `src/components/connection-tabs.tsx`

- [ ] **Step 1:** Create `src/lib/connections/first-page.ts`:
```ts
import type { TechId } from "./types";

/** The initial section a workspace tab opens at, per tech. Empty = the
 *  workspace root (overview). */
export const FIRST_PAGE: Record<TechId, string> = {
  docker: "containers",
  postgres: "",
  mysql: "",
  kafka: "",
  sqlserver: "",
  kubernetes: "pods",
  redis: "keys",
  mongo: "databases",
  r2: "",
  minio: "",
  s3: "",
};

export function workspaceHref(tech: TechId, id: string): string {
  const seg = FIRST_PAGE[tech];
  return seg ? `/${tech}/${id}/${seg}` : `/${tech}/${id}`;
}
```
- [ ] **Step 2:** In `connection-tabs.tsx`, delete the local `FIRST_PAGE` const + local `workspaceHref`, and import them: `import { FIRST_PAGE, workspaceHref } from "@/lib/connections/first-page";`. (Keep all other logic.) If `FIRST_PAGE` is referenced elsewhere in the file beyond `workspaceHref`, leave those references — they now resolve to the import.
- [ ] **Step 3:** `npx tsc --noEmit` — clean. **Step 4:** Commit:
```bash
git add src/lib/connections/first-page.ts src/components/connection-tabs.tsx
git commit -m "refactor: extract FIRST_PAGE/workspaceHref to shared module"
```

### Task 2: `TECH_SECTIONS` catalog (TDD)

**Files:** Create `src/lib/command-palette/sections.ts`, `src/lib/command-palette/sections.test.ts`

- [ ] **Step 1: Write the failing test:**
```ts
import { describe, it, expect } from "vitest";
import { TECH_SECTIONS } from "./sections";
import { TECH_CATALOG } from "@/lib/tech-catalog";

describe("TECH_SECTIONS", () => {
  it("has a non-empty entry for every available tech", () => {
    for (const t of TECH_CATALOG.filter((t) => t.status === "available")) {
      expect(TECH_SECTIONS[t.id as keyof typeof TECH_SECTIONS]?.length, t.id).toBeGreaterThan(0);
    }
  });
  it("every section has a label and a string seg", () => {
    for (const list of Object.values(TECH_SECTIONS)) {
      for (const s of list) {
        expect(typeof s.seg).toBe("string");
        expect(s.label.length).toBeGreaterThan(0);
      }
    }
  });
});
```
- [ ] **Step 2:** Run → FAIL (no module). `npx vitest run src/lib/command-palette/sections.test.ts`.
- [ ] **Step 3:** Create `src/lib/command-palette/sections.ts`:
```ts
import type { TechId } from "@/lib/connections/types";

export interface TechSection {
  label: string;
  /** Route segment after /<tech>/<id>/. Empty string = workspace root. */
  seg: string;
  /** lucide-react icon name. */
  icon: string;
}

export const TECH_SECTIONS: Record<TechId, TechSection[]> = {
  docker: [
    { label: "Containers", seg: "containers", icon: "Box" },
    { label: "Images", seg: "images", icon: "Layers" },
    { label: "Networks", seg: "networks", icon: "Network" },
    { label: "Volumes", seg: "volumes", icon: "HardDrive" },
    { label: "Stacks", seg: "stacks", icon: "Boxes" },
    { label: "Registries", seg: "registries", icon: "Container" },
    { label: "System", seg: "system", icon: "Activity" },
    { label: "Events", seg: "events", icon: "Radio" },
  ],
  postgres: [
    { label: "Databases", seg: "databases", icon: "Database" },
    { label: "Activity", seg: "activity", icon: "Activity" },
    { label: "Locks", seg: "locks", icon: "Lock" },
    { label: "Roles", seg: "roles", icon: "Users" },
    { label: "Extensions", seg: "extensions", icon: "Puzzle" },
    { label: "Diagnostics", seg: "diagnostics", icon: "Stethoscope" },
  ],
  mysql: [
    { label: "Databases", seg: "databases", icon: "Database" },
    { label: "Process list", seg: "processlist", icon: "Activity" },
  ],
  kafka: [
    { label: "Topics", seg: "", icon: "Radio" },
  ],
  sqlserver: [
    { label: "Databases", seg: "databases", icon: "Database" },
    { label: "Activity", seg: "activity", icon: "Activity" },
    { label: "Locks", seg: "locks", icon: "Lock" },
    { label: "Queries", seg: "queries", icon: "ListOrdered" },
    { label: "Query Store", seg: "query-store", icon: "Archive" },
    { label: "Query", seg: "query", icon: "Terminal" },
    { label: "Backup", seg: "backup", icon: "Save" },
    { label: "Indexes", seg: "indexes", icon: "ListTree" },
    { label: "Security", seg: "security", icon: "Shield" },
  ],
  kubernetes: [
    { label: "Pods", seg: "pods", icon: "Box" },
    { label: "Deployments", seg: "deployments", icon: "Layers" },
    { label: "Services", seg: "services", icon: "Network" },
    { label: "ConfigMaps", seg: "configmaps", icon: "FileText" },
    { label: "Secrets", seg: "secrets", icon: "KeyRound" },
    { label: "Namespaces", seg: "namespaces", icon: "Boxes" },
  ],
  redis: [
    { label: "Keys", seg: "keys", icon: "KeyRound" },
    { label: "CLI", seg: "cli", icon: "Terminal" },
    { label: "Pub/Sub", seg: "pubsub", icon: "Radio" },
    { label: "Streams", seg: "streams", icon: "Waves" },
    { label: "Monitor", seg: "monitor", icon: "Activity" },
    { label: "Cluster", seg: "cluster", icon: "Network" },
    { label: "ACL", seg: "acl", icon: "Shield" },
    { label: "Info", seg: "info", icon: "Info" },
  ],
  mongo: [
    { label: "Databases", seg: "databases", icon: "Database" },
    { label: "Current ops", seg: "current-op", icon: "Activity" },
    { label: "Server status", seg: "server-status", icon: "Gauge" },
    { label: "Replica set", seg: "repl-status", icon: "Network" },
  ],
  r2: [
    { label: "Overview", seg: "", icon: "LayoutDashboard" },
    { label: "Buckets", seg: "buckets", icon: "Boxes" },
  ],
  minio: [
    { label: "Overview", seg: "", icon: "LayoutDashboard" },
    { label: "Buckets", seg: "buckets", icon: "Boxes" },
  ],
  s3: [
    { label: "Overview", seg: "", icon: "LayoutDashboard" },
    { label: "Buckets", seg: "buckets", icon: "Boxes" },
  ],
};

export function sectionsFor(tech: TechId): TechSection[] {
  return TECH_SECTIONS[tech] ?? [];
}
```
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit:
```bash
git add src/lib/command-palette/sections.ts src/lib/command-palette/sections.test.ts
git commit -m "feat(palette): TECH_SECTIONS navigation catalog with tests"
```

### Task 3: Recent-connections LRU (TDD)

**Files:** Create `src/lib/command-palette/recent.ts`, `src/lib/command-palette/recent.test.ts`

- [ ] **Step 1: Write the failing test** (the LRU is pure; injectable storage so it's testable without a DOM):
```ts
import { describe, it, expect } from "vitest";
import { computeRecent } from "./recent";

describe("computeRecent", () => {
  it("puts the newest id first and dedupes", () => {
    expect(computeRecent(["a", "b"], "c")).toEqual(["c", "a", "b"]);
    expect(computeRecent(["a", "b"], "b")).toEqual(["b", "a"]);
  });
  it("caps the list length", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `id${i}`);
    const out = computeRecent(ten, "new", 8);
    expect(out).toHaveLength(8);
    expect(out[0]).toBe("new");
  });
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Create `src/lib/command-palette/recent.ts`:
```ts
const KEY = "baklava:recent-connections";
const CAP = 8;

/** Pure LRU step — exported for testing. */
export function computeRecent(prev: string[], id: string, cap = CAP): string[] {
  return [id, ...prev.filter((x) => x !== id)].slice(0, cap);
}

export function getRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function recordVisit(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(computeRecent(getRecent(), id)));
  } catch {
    /* ignore */
  }
}
```
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit:
```bash
git add src/lib/command-palette/recent.ts src/lib/command-palette/recent.test.ts
git commit -m "feat(palette): recent-connections LRU with tests"
```

### Task 4: Shared `useConnections` hook + record visits

**Files:** Create `src/lib/command-palette/use-connections.ts`; Modify `src/components/connection-tabs.tsx`, `src/components/workspace/workspace-shell.tsx`

- [ ] **Step 1:** Create `src/lib/command-palette/use-connections.ts` — a small client hook that fetches `/api/connections` once:
```ts
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
```
(Note: `connection-tabs.tsx` may keep its own fetch — extracting it there is optional and out of scope to avoid churn; the spec's de-dup is a nice-to-have, not required. The palette uses this hook independently. Skip modifying connection-tabs here.)
- [ ] **Step 2:** In `src/components/workspace/workspace-shell.tsx`, record the visit. Read the file; it receives the connection (it renders `connectionName`). Add at the top of the component body, deriving the id from the current path or an existing prop. If the shell already has `connectionId`/the connection record, use it: insert a `"use client"`-safe effect. If `WorkspaceShell` is a server component, instead create a tiny client `src/components/command-palette/record-visit.tsx`:
```tsx
"use client";
import { useEffect } from "react";
import { recordVisit } from "@/lib/command-palette/recent";
export function RecordVisit({ connectionId }: { connectionId: string }) {
  useEffect(() => { recordVisit(connectionId); }, [connectionId]);
  return null;
}
```
and render `<RecordVisit connectionId={…} />` inside `WorkspaceShell` (it already knows the connection; pass its id). Read `workspace-shell.tsx` to get the exact prop/id available and wire it.
- [ ] **Step 3:** `npx tsc --noEmit` clean. **Step 4:** Commit:
```bash
git add src/lib/command-palette/use-connections.ts src/components/command-palette/record-visit.tsx src/components/workspace/workspace-shell.tsx
git commit -m "feat(palette): useConnections hook + record-visit in workspace shell"
```

---

## Phase 2 — The palette (navigation: connections + sections + actions)

### Task 5: Open/close coordination

**Files:** Create `src/lib/command-palette/palette-events.ts`

- [ ] **Step 1:** A tiny module-level event so the header pill (in the server layout's client island) and the keydown handler both open the same dialog:
```ts
const EVENT = "baklava:open-command-palette";
export function openCommandPalette(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}
export function onOpenCommandPalette(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
```
- [ ] **Step 2:** Commit:
```bash
git add src/lib/command-palette/palette-events.ts
git commit -m "feat(palette): open-event bus for trigger coordination"
```

### Task 6: Global palette component

**Files:** Create `src/components/command-palette/global-command-palette.tsx`

- [ ] **Step 1:** Write the component. (Object-provider group is wired in Phase 3 — this task ships connections + sections + actions.)
```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as Icons from "lucide-react";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { useConnections } from "@/lib/command-palette/use-connections";
import { getRecent } from "@/lib/command-palette/recent";
import { sectionsFor } from "@/lib/command-palette/sections";
import { workspaceHref } from "@/lib/connections/first-page";
import { onOpenCommandPalette } from "@/lib/command-palette/palette-events";
import { useTheme } from "@/components/theme-provider";
import type { ConnectionRecord, TechId } from "@/lib/connections/types";
import { connectionSummaries } from "@/lib/connections/summaries";

function Icon({ name, className }: { name: string; className?: string }) {
  const C = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name];
  return C ? <C className={className ?? "size-3.5"} /> : null;
}

function currentConnId(pathname: string | null): { tech: TechId; id: string } | null {
  const m = pathname?.match(/^\/(docker|postgres|mysql|kafka|sqlserver|kubernetes|redis|mongo|r2|minio|s3)\/([^/]+)/);
  return m ? { tech: m[1] as TechId, id: m[2] } : null;
}

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { connections } = useConnections();
  const theme = useTheme();

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

  const go = (href: string) => { setOpen(false); router.push(href); };

  const recent = useMemo(() => {
    const order = getRecent();
    const rank = (c: ConnectionRecord) => {
      const i = order.indexOf(c.id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...connections].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [connections, open]); // re-read recents when reopened

  const here = currentConnId(pathname);
  const sections = here ? sectionsFor(here.tech) : [];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a connection, section, or action…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {here && sections.length > 0 ? (
          <CommandGroup heading="Go to">
            {sections.map((s) => (
              <CommandItem key={s.seg || "root"} value={`go ${s.label}`}
                onSelect={() => go(s.seg ? `/${here.tech}/${here.id}/${s.seg}` : `/${here.tech}/${here.id}`)}>
                <Icon name={s.icon} /> <span>{s.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandGroup heading="Connections">
          {recent.map((c) => (
            <CommandItem key={c.id} value={`conn ${c.name} ${c.tech}`}
              onSelect={() => go(workspaceHref(c.tech, c.id))}>
              <img src={`/icons/${c.tech}.svg`} alt="" className="size-3.5 dark:invert opacity-80" />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-[11px] text-muted-foreground truncate max-w-[40%]">
                {connectionSummaries[c.tech]?.(c) ?? c.tech}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Actions">
          <CommandItem value="action new connection" onSelect={() => go("/")}>
            <Icon name="Plus" /> <span>New connection…</span>
          </CommandItem>
          <CommandItem value="action home" onSelect={() => go("/")}>
            <Icon name="Home" /> <span>Go to home</span>
          </CommandItem>
          <CommandItem value="action toggle theme" onSelect={() => { setOpen(false); theme.toggle(); }}>
            <Icon name="SunMoon" /> <span>Toggle theme</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
```
- [ ] **Step 2:** Verify the API surface this component assumes against the real files, adjusting to reality (do not invent):
  - `useTheme()` shape: `grep -n "export function useTheme\|toggle\|setTheme" src/components/theme-provider.tsx`. If the toggle is named differently (e.g. `setTheme`/`cycle`), use that. If there's no hook, reuse the logic inside `src/components/theme-toggle.tsx` instead (import and render its handler).
  - `connectionSummaries` import shape: `grep -n "connectionSummaries" src/lib/connections/summaries.ts` (it's a `Record<TechId, (r) => string>`).
  - `CommandDialog` props: confirm it takes `open`/`onOpenChange` (`grep -n "CommandDialog" src/components/ui/command.tsx`).
  Adjust the component to match; report any change.
- [ ] **Step 3:** `npx tsc --noEmit && npm run lint` — clean. (The `<img>` may trip `@next/next/no-img-element`; if so, add the same eslint-disable the codebase already uses for tech icons — check `connection-sheet.tsx` for the existing pattern.)
- [ ] **Step 4:** Commit:
```bash
git add src/components/command-palette/global-command-palette.tsx
git commit -m "feat(palette): global command palette — connections, sections, actions"
```

### Task 7: Mount the palette + header pill in the root layout

**Files:** Modify `src/app/layout.tsx`; Create `src/components/command-palette/palette-trigger.tsx`

- [ ] **Step 1:** Create the header pill (client):
```tsx
"use client";
import { useEffect, useState } from "react";
import { openCommandPalette } from "@/lib/command-palette/palette-events";

export function PaletteTrigger() {
  const [mac, setMac] = useState(false);
  useEffect(() => { setMac(/Mac|iPhone|iPad/.test(navigator.platform)); }, []);
  return (
    <button
      onClick={openCommandPalette}
      title="Command palette"
      className="hidden sm:inline-flex items-center gap-1 rounded-md border border-border/70 px-2 h-7 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
    >
      <span>Search</span>
      <kbd className="font-mono text-[10px] opacity-80">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}
```
- [ ] **Step 2:** In `src/app/layout.tsx`, import and mount. Add the trigger in the header's right cluster (next to `<ThemeToggle />`), and the palette near `<Toaster />`:
```tsx
import { GlobalCommandPalette } from "@/components/command-palette/global-command-palette";
import { PaletteTrigger } from "@/components/command-palette/palette-trigger";
```
Header right cluster becomes:
```tsx
<div className="flex items-center gap-1.5 pl-2 shrink-0">
  <PaletteTrigger />
  <ThemeToggle />
</div>
```
And before `</TooltipProvider>` (after `<main>`), add `<GlobalCommandPalette />` (alongside `<Toaster />`).
- [ ] **Step 3:** `npx tsc --noEmit && npm run lint` — clean.
- [ ] **Step 4:** Commit:
```bash
git add src/app/layout.tsx src/components/command-palette/palette-trigger.tsx
git commit -m "feat(palette): mount global palette + header ⌘K trigger in root layout"
```

### Task 8: Phase-2 verification (navigation works)

- [ ] **Step 1:** `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` — all clean.
- [ ] **Step 2:** Live browser smoke: `npm run dev`; on the home grid press ⌘K → type a connection name → Enter → lands in that workspace. Inside a workspace press ⌘K → "Go to" group lists that tech's sections → Enter → navigates. Click the header pill → same palette opens. Toggle theme action works. (No commit — verification.)

---

## Phase 3 — Fold in the 4 existing object searches; remove their hosts

> The 4 techs (postgres/mysql/sqlserver/kubernetes) currently mount their own ⌘K palette. After Phase 2 there are temporarily TWO ⌘K handlers on those techs. This phase removes the per-tech hosts and re-exposes their object search through the global palette.

### Task 9: Object-provider interface + Postgres provider

**Files:** Create `src/lib/command-palette/object-providers.ts`

- [ ] **Step 1:** Read `src/components/postgres/command-palette.tsx` to confirm the object-fetch endpoint + result→href mapping (it fetches `/api/postgres/${id}/databases/${db}/all-relations` and maps relations → `/postgres/${id}/databases/${db}/schemas/${schema}/tables/${name}`). Then create:
```ts
import type { TechId } from "@/lib/connections/types";

export interface PaletteObject { label: string; sublabel?: string; href: string; icon?: string }
export type ObjectProvider = (connectionId: string, query: string, ctx: { pathname: string }) => Promise<PaletteObject[]>;

/** Pull the active database from a /<tech>/<id>/databases/<db>/... path. */
function dbFromPath(tech: string, pathname: string): string | null {
  const m = pathname.match(new RegExp(`^/${tech}/[^/]+/databases/([^/]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

const postgresProvider: ObjectProvider = async (id, query, { pathname }) => {
  const db = dbFromPath("postgres", pathname);
  if (!db || query.trim().length < 1) return [];
  try {
    const res = await fetch(`/api/postgres/${id}/databases/${encodeURIComponent(db)}/all-relations`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { relations?: Array<{ schema: string; name: string }> };
    const q = query.toLowerCase();
    return (data.relations ?? [])
      .filter((r) => r.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((r) => ({
        label: r.name,
        sublabel: `${db}.${r.schema}`,
        href: `/postgres/${id}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(r.schema)}/tables/${encodeURIComponent(r.name)}`,
        icon: "Table2",
      }));
  } catch {
    return [];
  }
};

export const OBJECT_PROVIDERS: Partial<Record<TechId, ObjectProvider>> = {
  postgres: postgresProvider,
};
```
(If `all-relations` returns a different shape than `{relations:[{schema,name}]}`, match the actual shape from the file you read — report the adjustment.)
- [ ] **Step 2:** Commit:
```bash
git add src/lib/command-palette/object-providers.ts
git commit -m "feat(palette): object-provider interface + Postgres provider"
```

### Task 10: MySQL, SQL Server, Kubernetes providers

**Files:** Modify `src/lib/command-palette/object-providers.ts`

- [ ] **Step 1:** Read each existing host/palette to find its object-fetch endpoint + href mapping, then add a provider mirroring the Postgres one:
  - **mysql** — read `src/app/mysql/[connectionId]/command-palette-host.tsx` (+ any palette it renders). Add `mysqlProvider` using the same endpoint it calls (tables within the active database, path `/mysql/<id>/databases/<db>` based — use `dbFromPath("mysql", pathname)`); map to the table route it links to.
  - **sqlserver** — read `src/app/sqlserver/[connectionId]/command-palette-host.tsx`. Add `sqlserverProvider`; SQL Server tables are `schema.table` under a db — map to the route the existing palette uses (`/sqlserver/<id>/databases/<db>/tables/<schema>/<table>`).
  - **kubernetes** — read `src/app/kubernetes/[connectionId]/k8s-shell.tsx`. Add `kubernetesProvider` returning pods/resources in the active namespace, mapping to the route the shell links to.
  Each provider: same try/catch → `[]` on failure; filter by `query`; cap ~25.
- [ ] **Step 2:** Register all three in `OBJECT_PROVIDERS`. `npx tsc --noEmit` clean.
- [ ] **Step 3:** Commit:
```bash
git add src/lib/command-palette/object-providers.ts
git commit -m "feat(palette): MySQL, SQL Server, Kubernetes object providers"
```

### Task 11: Wire the "In this connection" group into the palette

**Files:** Modify `src/components/command-palette/global-command-palette.tsx`

- [ ] **Step 1:** Add debounced object fetching. Inside the component, after `here`/`sections`:
```tsx
const [query, setQuery] = useState("");
const [objects, setObjects] = useState<import("@/lib/command-palette/object-providers").PaletteObject[]>([]);
useEffect(() => {
  if (!here) { setObjects([]); return; }
  const provider = (require("@/lib/command-palette/object-providers").OBJECT_PROVIDERS as Record<string, undefined | ((id: string, q: string, ctx: { pathname: string }) => Promise<unknown[]>)>)[here.tech];
  if (!provider || !open) { setObjects([]); return; }
  const t = setTimeout(() => {
    void provider(here.id, query, { pathname: pathname ?? "" }).then((r) => setObjects(r as never[]));
  }, 150);
  return () => clearTimeout(t);
}, [here, query, open, pathname]);
```
(Replace the dynamic `require` with a top-of-file `import { OBJECT_PROVIDERS } from "@/lib/command-palette/object-providers";` and use it directly — the `require` form above is only shorthand; use the static import.) Bind `CommandInput`'s value: `<CommandInput value={query} onValueChange={setQuery} placeholder=… />`. Render the group **above** "Connections" when `objects.length`:
```tsx
{objects.length > 0 ? (
  <CommandGroup heading="In this connection">
    {objects.map((o) => (
      <CommandItem key={o.href} value={`obj ${o.label} ${o.sublabel ?? ""}`} onSelect={() => go(o.href)}>
        <Icon name={o.icon ?? "Circle"} />
        <span className="flex-1 truncate">{o.label}</span>
        {o.sublabel ? <span className="text-[11px] text-muted-foreground">{o.sublabel}</span> : null}
      </CommandItem>
    ))}
  </CommandGroup>
) : null}
```
Note: cmdk filters items by their `value`; since object results are already server-filtered by `query`, set `shouldFilter={false}` on the `Command`/`CommandDialog` OR ensure each `value` contains the query text. Simplest: keep cmdk filtering for static groups and include the label in `value` (already done) — acceptable. Confirm behavior in the smoke test.
- [ ] **Step 2:** `npx tsc --noEmit && npm run lint` clean. **Step 3:** Commit:
```bash
git add src/components/command-palette/global-command-palette.tsx
git commit -m "feat(palette): fold in object search as 'In this connection' group"
```

### Task 12: Remove the 4 per-tech palette hosts

**Files:** Modify `src/app/postgres/[connectionId]/layout.tsx`, `.../mysql/...layout.tsx`, `.../sqlserver/...layout.tsx`, `src/app/kubernetes/[connectionId]/k8s-shell.tsx`; Delete the 3 `command-palette-host.tsx` + `src/components/postgres/command-palette.tsx` (+ any mysql/sqlserver/k8s palette components no longer referenced)

- [ ] **Step 1:** In each of postgres/mysql/sqlserver layout, remove the `<CommandPaletteHost … />` mount and its import. In `k8s-shell.tsx`, remove the ⌘K keydown handler + the palette it opened (keep the rest of the shell — terminal etc.). Read each file first; remove only the palette wiring.
- [ ] **Step 2:** `git rm` the now-unreferenced host/palette files:
```bash
git rm "src/app/postgres/[connectionId]/command-palette-host.tsx" "src/app/mysql/[connectionId]/command-palette-host.tsx" "src/app/sqlserver/[connectionId]/command-palette-host.tsx"
```
For `src/components/postgres/command-palette.tsx` and any mysql/sqlserver/k8s palette component: `grep -rl` to confirm zero remaining importers, then `git rm`. If a component is still imported elsewhere, leave it.
- [ ] **Step 3:** `npx tsc --noEmit && npm run lint` clean. Confirm **only one** ⌘K handler remains: `grep -rn "metaKey\|ctrlKey\).*k\b\|key.*===.*\"k\"" src/ | grep -vi global-command-palette` should return nothing palette-related.
- [ ] **Step 4:** Commit:
```bash
git add -A
git commit -m "refactor: remove per-tech ⌘K palettes; global palette is the sole ⌘K owner"
```

---

## Phase 4 — Final verification

### Task 13: Gates + behavior-preservation smoke

- [ ] **Step 1:** `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (report count), `npm run build` — all green.
- [ ] **Step 2:** Live smoke (`npm run dev`):
  - Home ⌘K → jump to a connection (each of a few techs). ✓
  - In a workspace ⌘K → "Go to" sections navigate. ✓
  - **Fold-in / no-regression:** open a Postgres connection, navigate into a database, ⌘K, type a table name → it appears under "In this connection" → Enter opens the table. Repeat sanity for mysql/sqlserver/kubernetes if those services are available; otherwise confirm the provider is wired (no crash, empty group) and rely on code review.
  - **Single ⌘K:** on a Postgres page, ⌘K opens exactly one dialog (no double-open). ✓
  - Header pill opens the palette. ✓
- [ ] **Step 3:** No commit (verification).

### Task 14: Finish the branch

- [ ] **Step 1:** Invoke `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:** root-layout mount + owns ⌘K (Task 7); `TECH_SECTIONS` (Task 2); `recent.ts` LRU (Task 3); `useConnections` + record-visit (Task 4); palette groups connections/go-to/actions (Task 6) + in-this-connection (Task 11); object providers folding in the 4 techs (Tasks 9–10); header pill (Task 7); removal/reconciliation of the 4 hosts (Task 12); FIRST_PAGE extraction (Task 1); tests (Tasks 2,3) + smoke (Tasks 8,13). All covered.

**Placeholder scan:** Tasks 10 and 12 instruct the implementer to *read a named existing file* and mirror/remove its logic, rather than reproducing code I have not read — these name the exact file, endpoint pattern, and target shape, so they are concrete relocation instructions, not vague placeholders. Task 6 Step 2 lists explicit grep-and-adjust checks against real APIs (theme hook, CommandDialog props) instead of guessing signatures.

**Type consistency:** `FIRST_PAGE`/`workspaceHref` (shared module) used by tabs + palette; `TechSection`/`TECH_SECTIONS`/`sectionsFor`; `computeRecent`/`getRecent`/`recordVisit`; `useConnections` returns `{connections, fetched}`; `PaletteObject`/`ObjectProvider`/`OBJECT_PROVIDERS`; `openCommandPalette`/`onOpenCommandPalette`. Names are consistent across tasks.
