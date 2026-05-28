interface Props {
  resource: string;
  error: string;
}

/**
 * Rendered in place of a resource table when the driver throws — bad
 * kubeconfig, unreachable apiserver, auth failure, etc. Mirrors the k9s
 * "—— ERROR ——" footer aesthetic without crashing the whole workspace.
 */
export function LoadError({ resource, error }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col font-mono text-[12.5px]">
      <div className="px-4 py-2 flex items-center gap-3 border-b border-border/60 bg-background/40">
        <span className="text-foreground font-semibold tracking-tight text-sm">
          {resource}
        </span>
        <span className="uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-700 dark:text-red-300">
          unreachable
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-10 space-y-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            could not list {resource}
          </div>
          <pre className="text-red-600 dark:text-red-400 text-xs whitespace-pre-wrap break-words border border-red-500/30 bg-red-500/5 rounded p-3 leading-relaxed">
            {error}
          </pre>
          <div className="text-[11px] text-muted-foreground leading-relaxed">
            Check that the kubeconfig path or YAML you saved points at a
            reachable cluster, that the selected context exists, and that
            your credentials have not expired. The connection card under{" "}
            <span className="font-medium text-foreground">/kubernetes</span>{" "}
            lets you re-test and edit the config.
          </div>
        </div>
      </div>
    </div>
  );
}
