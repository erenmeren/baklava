"use client";
import { useEffect, useState } from "react";
import type { ConnectionRecord } from "@/lib/connections/types";
import { isAiSupported } from "@/lib/ai/supported";

export function ConnectionPicker({
  value,
  onChange,
}: {
  value: ConnectionRecord | null;
  onChange: (c: ConnectionRecord | null) => void;
}) {
  const [conns, setConns] = useState<ConnectionRecord[]>([]);
  useEffect(() => {
    fetch("/api/connections", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { connections?: ConnectionRecord[] }) =>
        setConns((d.connections ?? []).filter((c) => isAiSupported(c.tech))),
      )
      .catch(() => {});
  }, []);
  return (
    <select
      value={value?.id ?? ""}
      onChange={(e) => onChange(conns.find((c) => c.id === e.target.value) ?? null)}
      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
    >
      <option value="">Pick a connection…</option>
      {conns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({c.tech})
        </option>
      ))}
    </select>
  );
}
