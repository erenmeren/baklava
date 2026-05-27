"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { K8sContextProvider } from "./k8s-context";
import { CommandPalette } from "./command-palette";
import { HelpOverlay } from "./help-overlay";

interface Props {
  connectionId: string;
  namespaces: string[];
  initialNamespace: string;
  context: string;
  serverVersion: string;
  children: React.ReactNode;
}

/**
 * The k9s-inspired chrome that wraps every workspace page. Owns:
 *   - the active namespace (with persistence across navigations)
 *   - the resource-table filter (single search box on `/`)
 *   - the command palette on `:`
 *   - the help overlay on `?`
 *   - the persistent bottom hotkey bar
 *
 * We also publish the namespace + filter through K8sContextProvider so the
 * resource tables can read them without prop-drilling.
 */
export function K8sShell({
  connectionId,
  namespaces,
  initialNamespace,
  context,
  serverVersion,
  children,
}: Props) {
  const router = useRouter();
  const [namespace, setNamespace] = useState(initialNamespace);
  const [filter, setFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Global key bindings — the soul of the k9s feel. We swallow them only
  // when no input/textarea/contenteditable is focused, so they never fight
  // with the connection form or the command palette.
  useEffect(() => {
    function isTyping() {
      const a = document.activeElement;
      if (!a) return false;
      const tag = a.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if ((a as HTMLElement).isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      // Esc closes whatever overlay is open + the filter
      if (e.key === "Escape") {
        if (commandOpen) { setCommandOpen(false); return; }
        if (helpOpen) { setHelpOpen(false); return; }
        if (filterOpen) {
          setFilterOpen(false);
          setFilter("");
          (document.activeElement as HTMLElement)?.blur?.();
          return;
        }
      }

      if (isTyping()) return;

      // `:` opens the command palette (regardless of shift state — colon is
      // typically shift-; but we accept both Code variants and the
      // dead-simple e.key === ":" path).
      if (e.key === ":" || (e.shiftKey && e.code === "Semicolon")) {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }

      // `/` focuses the filter
      if (e.key === "/") {
        e.preventDefault();
        setFilterOpen(true);
        return;
      }

      // `?` opens help
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      // 1..6 — resource shortcuts to mirror the sidebar
      const numMap: Record<string, string> = {
        "1": "pods",
        "2": "deployments",
        "3": "services",
        "4": "configmaps",
        "5": "secrets",
        "6": "namespaces",
      };
      if (numMap[e.key]) {
        e.preventDefault();
        router.push(`/kubernetes/${connectionId}/${numMap[e.key]}`);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connectionId, router, commandOpen, helpOpen, filterOpen]);

  const ctxValue = useMemo(
    () => ({
      connectionId,
      namespace,
      setNamespace,
      namespaces,
      filter,
      setFilter,
      setFilterOpen,
      setCommandOpen,
      setHelpOpen,
      context,
      serverVersion,
    }),
    [connectionId, namespace, namespaces, filter, context, serverVersion],
  );

  // The command palette runs commands — we translate them here so it can
  // call back into the shell's state + router without itself depending on
  // any of it.
  const runCommand = useCallback(
    (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;
      const [head, ...rest] = trimmed.split(/\s+/);
      const arg = rest.join(" ");
      const ALIASES: Record<string, string> = {
        po: "pods",
        pod: "pods",
        pods: "pods",
        deploy: "deployments",
        deployments: "deployments",
        dep: "deployments",
        svc: "services",
        service: "services",
        services: "services",
        cm: "configmaps",
        configmap: "configmaps",
        configmaps: "configmaps",
        sec: "secrets",
        secret: "secrets",
        secrets: "secrets",
        ns: arg ? "__ns_switch" : "namespaces",
        namespace: arg ? "__ns_switch" : "namespaces",
        namespaces: "namespaces",
      };
      const target = ALIASES[head.toLowerCase()];
      setCommandOpen(false);
      if (!target) return;
      if (target === "__ns_switch") {
        setNamespace(arg === "*" || arg === "all" ? "*" : arg);
        return;
      }
      router.push(`/kubernetes/${connectionId}/${target}`);
    },
    [connectionId, router],
  );

  return (
    <K8sContextProvider value={ctxValue}>
      <div className="flex h-full min-h-0 flex-col bg-background relative">
        {/* Top context strip */}
        <ContextStrip
          context={context}
          serverVersion={serverVersion}
          namespace={namespace}
          namespaces={namespaces}
          onNamespaceChange={setNamespace}
          filterOpen={filterOpen}
          filter={filter}
          onFilterChange={setFilter}
          onFilterToggle={() => setFilterOpen((o) => !o)}
          onFilterClose={() => {
            setFilterOpen(false);
            setFilter("");
          }}
          onCommand={() => setCommandOpen(true)}
          onHelp={() => setHelpOpen(true)}
        />

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>

        {/* Hotkey bar */}
        <HotkeyBar />

        {commandOpen ? (
          <CommandPalette
            namespaces={namespaces}
            onRun={runCommand}
            onClose={() => setCommandOpen(false)}
          />
        ) : null}

        {helpOpen ? <HelpOverlay onClose={() => setHelpOpen(false)} /> : null}
      </div>
    </K8sContextProvider>
  );
}

function ContextStrip(props: {
  context: string;
  serverVersion: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (ns: string) => void;
  filterOpen: boolean;
  filter: string;
  onFilterChange: (s: string) => void;
  onFilterToggle: () => void;
  onFilterClose: () => void;
  onCommand: () => void;
  onHelp: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Focus the filter input every time it opens — works for both `/` keypress
  // and the toolbar button click without sharing the ref across components.
  useEffect(() => {
    if (props.filterOpen) inputRef.current?.focus();
  }, [props.filterOpen]);
  return (
    <div className="shrink-0 border-b border-border/60 bg-muted/30">
      {/* Row 1 — context, version, namespace selector, search, cmd, help */}
      <div className="flex items-center gap-3 px-4 py-2 font-mono text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500 status-pulse" />
          <span className="uppercase tracking-[0.22em] text-[9px]">cluster</span>
          <span className="text-foreground">{props.context}</span>
        </span>
        <Separator />
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="uppercase tracking-[0.22em] text-[9px]">ver</span>
          <span className="text-foreground">{props.serverVersion}</span>
        </span>
        <Separator />
        <NamespacePill
          namespace={props.namespace}
          namespaces={props.namespaces}
          onChange={props.onNamespaceChange}
        />

        <div className="flex-1" />

        <button
          onClick={props.onFilterToggle}
          className={cn(
            "inline-flex items-center gap-1.5 rounded border px-2 py-1 transition-colors",
            props.filterOpen
              ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
              : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
          )}
        >
          <kbd className="text-[10px]">/</kbd>
          <span>filter</span>
        </button>
        <button
          onClick={props.onCommand}
          className="inline-flex items-center gap-1.5 rounded border border-border/60 px-2 py-1 text-muted-foreground hover:text-foreground hover:border-border"
        >
          <kbd className="text-[10px]">:</kbd>
          <span>cmd</span>
        </button>
        <button
          onClick={props.onHelp}
          className="inline-flex items-center gap-1.5 rounded border border-border/60 px-2 py-1 text-muted-foreground hover:text-foreground hover:border-border"
        >
          <kbd className="text-[10px]">?</kbd>
          <span>help</span>
        </button>
      </div>

      {/* Row 2 — filter (animated open/close) */}
      {props.filterOpen ? (
        <div className="px-4 pb-2 -mt-1 flex items-center gap-2">
          <span className="font-mono text-cyan-600 dark:text-cyan-400 text-sm select-none">
            /
          </span>
          <input
            ref={inputRef}
            value={props.filter}
            onChange={(e) => props.onFilterChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                props.onFilterClose();
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="substring match…"
            className="flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/60"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="font-mono text-[10px] text-muted-foreground">
            esc to close
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Separator() {
  return <span className="h-3 w-px bg-border/70" />;
}

function NamespacePill({
  namespace,
  namespaces,
  onChange,
}: {
  namespace: string;
  namespaces: string[];
  onChange: (ns: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-2 py-1 transition-colors",
          "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/15",
        )}
      >
        <span className="uppercase tracking-[0.22em] text-[9px] opacity-80">
          ns
        </span>
        <span className="font-medium">
          {namespace === "*" ? "all-namespaces" : namespace}
        </span>
        <span className="opacity-60">▾</span>
      </button>
      {open ? (
        <div className="absolute top-full left-0 mt-1 z-30 min-w-[180px] rounded-md border border-border/70 bg-popover shadow-lg shadow-black/20 py-1 font-mono text-xs">
          <button
            onClick={() => {
              onChange("*");
              setOpen(false);
            }}
            className={cn(
              "block w-full text-left px-3 py-1.5 hover:bg-foreground/5",
              namespace === "*" ? "text-cyan-600 dark:text-cyan-400" : "",
            )}
          >
            <span className="opacity-60 mr-1.5">*</span>all-namespaces
          </button>
          <div className="my-1 mx-2 border-t border-border/60" />
          {namespaces.map((ns) => (
            <button
              key={ns}
              onClick={() => {
                onChange(ns);
                setOpen(false);
              }}
              className={cn(
                "block w-full text-left px-3 py-1.5 hover:bg-foreground/5",
                namespace === ns ? "text-cyan-600 dark:text-cyan-400" : "",
              )}
            >
              {ns}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HotkeyBar() {
  // The hint bar uses the same vocabulary as k9s so muscle memory carries
  // over: <l>ogs, <d>escribe, <s>hell, <e>dit, <D>elete (capital), etc.
  const items: { k: string; label: string; danger?: boolean }[] = [
    { k: "↵", label: "describe" },
    { k: "l", label: "logs" },
    { k: "s", label: "shell" },
    { k: "y", label: "yaml" },
    { k: "e", label: "edit" },
    { k: "D", label: "delete", danger: true },
    { k: "/", label: "filter" },
    { k: ":", label: "cmd" },
    { k: "?", label: "help" },
  ];
  return (
    <div className="shrink-0 border-t border-border/60 bg-muted/40 px-4 py-1.5 font-mono text-[10.5px] flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
      {items.map((i) => (
        <span key={i.k} className="inline-flex items-center gap-1.5">
          <kbd
            className={cn(
              "inline-flex min-w-[16px] justify-center rounded border px-1 py-0 text-[9.5px]",
              i.danger
                ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
                : "border-border/60 bg-background/60 text-foreground/80",
            )}
          >
            {i.k}
          </kbd>
          <span className={i.danger ? "text-red-600 dark:text-red-400" : ""}>
            {i.label}
          </span>
        </span>
      ))}
      <span className="ml-auto opacity-60 text-[9.5px] uppercase tracking-[0.22em]">
        baklava · k9s mode
      </span>
    </div>
  );
}
