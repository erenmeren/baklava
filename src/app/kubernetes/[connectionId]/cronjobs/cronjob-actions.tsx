"use client";

import { useState } from "react";
import type { CronJobRow } from "@/lib/kubernetes/row-types";
import { Shell } from "../workload-actions";

interface Props {
  connectionId: string;
  row: CronJobRow;
  /** "trigger" runs it now; "suspend" toggles spec.suspend from the row's current value. */
  action: "trigger" | "suspend";
  close: () => void;
  refresh: () => void;
}

export function CronJobDialog({ connectionId, row, action, close, refresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verb = action === "trigger" ? "trigger" : row.suspend ? "resume" : "suspend";

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/kubernetes/${connectionId}/cronjobs/${encodeURIComponent(
          row.namespace,
        )}/${encodeURIComponent(row.name)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: verb }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error || `request failed (${res.status})`);
      refresh();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const target = (
    <span className="font-mono text-foreground">
      {row.namespace}/{row.name}
    </span>
  );
  return (
    <Shell
      tone="amber"
      tag="cronjob"
      title={verb === "trigger" ? "Run cronjob now?" : `${verb[0].toUpperCase()}${verb.slice(1)} cronjob?`}
      error={error}
      onClose={close}
      action={
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-mono"
        >
          {busy ? "working…" : `${verb} ${row.name}`}
        </button>
      }
    >
      <span className="block">
        {verb === "trigger" ? (
          <>
            Creates a Job from {target}&apos;s job template right now, the way{" "}
            <span className="font-mono">kubectl create job --from=cronjob/{row.name}</span> does.
            The schedule is unaffected.
          </>
        ) : verb === "suspend" ? (
          <>Stops {target} from scheduling new runs. Jobs already running keep going.</>
        ) : (
          <>Lets {target} schedule runs again from its next scheduled time.</>
        )}
      </span>
    </Shell>
  );
}
