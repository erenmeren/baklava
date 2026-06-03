"use client";
import { useState } from "react";
import { toast } from "sonner";
import type { ConnectionRecord, TechId } from "@/lib/connections/types";

export function useBlobConnectionForm<P>(opts: {
  tech: TechId;
  initial?: ConnectionRecord;
  defaultName: string;
  buildConfig: () => Record<string, unknown>;
  onSaved?: () => void;
  /** Extra fields merged into the edit-mode PATCH body (e.g. { unset: ["sessionToken"] }). */
  patchExtra?: () => Record<string, unknown>;
  /** Description for the "Connection works" toast on a non-save test. */
  okDescription?: (probe: P) => string;
}) {
  const editing = Boolean(opts.initial);
  const [name, setName] = useState(opts.initial?.name ?? opts.defaultName);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<P | null>(null);

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      if (save && editing && opts.initial) {
        const res = await fetch(`/api/connections/${opts.initial.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, config: opts.buildConfig(), ...(opts.patchExtra?.() ?? {}) }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success("Connection updated");
          opts.onSaved?.();
        } else {
          setError(data.error || "Update failed");
          toast.error("Update failed", { description: data.error });
        }
        return;
      }
      const res = await fetch(`/api/${opts.tech}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config: opts.buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setProbe(data.probe as P);
        if (save) {
          toast.success("Connection saved");
          opts.onSaved?.();
        } else {
          toast.success("Connection works", { description: opts.okDescription?.(data.probe as P) });
        }
      } else {
        setError(data.error || "Connection failed");
        toast.error("Connection failed", { description: data.error });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Request failed", { description: msg });
    } finally {
      setTesting(false);
    }
  };

  return { editing, name, setName, testing, error, probe, test };
}
