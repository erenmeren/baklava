"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Power, RefreshCcw, TerminalSquare } from "lucide-react";
import { toast } from "sonner";

interface Props {
  connectionId: string;
  cid: string;
  running: boolean;
  active: boolean;
}

const SHELLS = ["/bin/sh", "/bin/bash", "/bin/ash", "/bin/zsh"];

export function TerminalTab({ connectionId, cid, running, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{
    term: import("@xterm/xterm").Terminal;
    fit: import("@xterm/addon-fit").FitAddon;
  } | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [shell, setShell] = useState("/bin/sh");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tearDown = useCallback(async () => {
    sourceRef.current?.close();
    sourceRef.current = null;
    if (sessionRef.current) {
      const sid = sessionRef.current;
      sessionRef.current = null;
      try {
        await fetch(
          `/api/docker/${connectionId}/containers/${cid}/terminal/${sid}`,
          { method: "DELETE" }
        );
      } catch {
        // ignore
      }
    }
    setConnected(false);
  }, [connectionId, cid]);

  const start = useCallback(async () => {
    if (!containerRef.current || !termRef.current) return;
    setConnecting(true);
    setError(null);
    try {
      const { term } = termRef.current;
      const cols = term.cols;
      const rows = term.rows;
      const res = await fetch(
        `/api/docker/${connectionId}/containers/${cid}/terminal`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ shell, cols, rows }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not start session");
        return;
      }
      sessionRef.current = data.sessionId as string;
      setConnected(true);

      const es = new EventSource(
        `/api/docker/${connectionId}/containers/${cid}/terminal/${data.sessionId}/stream`
      );
      sourceRef.current = es;
      es.addEventListener("data", (ev) => {
        try {
          const b64 = JSON.parse((ev as MessageEvent).data) as string;
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          term.write(bytes);
        } catch {
          // ignore
        }
      });
      es.addEventListener("end", (ev) => {
        try {
          const r = JSON.parse((ev as MessageEvent).data) as {
            code?: number | null;
          };
          term.writeln(
            `\r\n\x1b[33m[session ended${r.code != null ? ` · exit ${r.code}` : ""}]\x1b[0m`
          );
        } catch {
          term.writeln("\r\n\x1b[33m[session ended]\x1b[0m");
        }
        setConnected(false);
        sourceRef.current?.close();
        sourceRef.current = null;
        sessionRef.current = null;
      });
      es.addEventListener("error", () => {
        // EventSource auto-reconnects but session likely gone; mark disconnected
        if (sessionRef.current) {
          // soft warning
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, [connectionId, cid, shell]);

  // Mount xterm exactly once when this tab is first activated.
  useEffect(() => {
    if (!active) return;
    if (termRef.current || !containerRef.current) return;

    let cancelled = false;
    (async () => {
      // Inject xterm CSS once.
      if (typeof document !== "undefined" && !document.getElementById("xterm-css")) {
        const link = document.createElement("link");
        link.id = "xterm-css";
        link.rel = "stylesheet";
        link.href = "/xterm.css";
        // Fallback to CDN inline if local missing — we'll inline via JS instead.
        document.head.appendChild(link);
      }

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (cancelled || !containerRef.current) return;
      const term = new Terminal({
        fontFamily:
          'var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace',
        fontSize: 13,
        cursorBlink: true,
        theme: {
          background: "#0a0a0c",
          foreground: "#f5f5f4",
          cursor: "#f4b528",
          selectionBackground: "#f4b52866",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      try {
        fit.fit();
      } catch {
        // ignore
      }
      termRef.current = { term, fit };

      term.onData((data) => {
        if (!sessionRef.current) return;
        fetch(
          `/api/docker/${connectionId}/containers/${cid}/terminal/${sessionRef.current}/input`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ data }),
          }
        ).catch(() => undefined);
      });

      const onResize = () => {
        if (!termRef.current || !sessionRef.current) return;
        try {
          termRef.current.fit.fit();
        } catch {
          // ignore
        }
        const { cols, rows } = termRef.current.term;
        fetch(
          `/api/docker/${connectionId}/containers/${cid}/terminal/${sessionRef.current}/resize`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cols, rows }),
          }
        ).catch(() => undefined);
      };
      window.addEventListener("resize", onResize);

      term.writeln(
        "\x1b[2m  baklava terminal — pick a shell and click Start.\x1b[0m"
      );

      // store cleanup
      return () => window.removeEventListener("resize", onResize);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, connectionId, cid]);

  // Re-fit when this tab becomes active.
  useEffect(() => {
    if (active && termRef.current) {
      try {
        termRef.current.fit.fit();
      } catch {
        // ignore
      }
    }
  }, [active]);

  // Tear down on unmount or container stop.
  useEffect(() => {
    return () => {
      tearDown();
      termRef.current?.term.dispose();
      termRef.current = null;
    };
  }, [tearDown]);

  useEffect(() => {
    if (!running && connected) {
      tearDown().then(() => {
        toast.error("Container stopped — terminal session ended");
      });
    }
  }, [running, connected, tearDown]);

  return (
    <div className="flex flex-col h-[60vh] gap-3">
      <div className="flex items-center gap-2">
        <select
          value={shell}
          onChange={(e) => setShell(e.target.value)}
          disabled={connected || connecting}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs font-mono shadow-xs"
        >
          {SHELLS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {connected ? (
          <Button size="sm" variant="outline" onClick={tearDown}>
            <Power className="size-3.5" />
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={start}
            disabled={!running || connecting}
          >
            {connecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <TerminalSquare className="size-3.5" />
            )}
            Start
          </Button>
        )}
        {connected ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500 status-pulse" />
            attached · {shell}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {running
              ? "Detached. Click Start to attach a shell."
              : "Container is not running."}
          </span>
        )}
        {connected ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              if (termRef.current) termRef.current.term.clear();
            }}
          >
            <RefreshCcw className="size-3.5" />
            Clear
          </Button>
        ) : null}
      </div>
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs font-mono text-destructive break-words">
          {error}
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 rounded-lg border border-border/60 bg-[#0a0a0c] p-2 overflow-hidden"
      />
    </div>
  );
}
