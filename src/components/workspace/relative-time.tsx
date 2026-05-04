"use client";

import { useEffect, useState } from "react";

const UNITS: { ms: number; name: string }[] = [
  { ms: 365 * 24 * 60 * 60 * 1000, name: "y" },
  { ms: 30 * 24 * 60 * 60 * 1000, name: "mo" },
  { ms: 24 * 60 * 60 * 1000, name: "d" },
  { ms: 60 * 60 * 1000, name: "h" },
  { ms: 60 * 1000, name: "m" },
  { ms: 1000, name: "s" },
];

export function relativeTime(timestamp: number | string | Date): string {
  const t =
    typeof timestamp === "number"
      ? timestamp < 1e12
        ? timestamp * 1000
        : timestamp
      : new Date(timestamp).getTime();
  const diff = Date.now() - t;
  if (diff < 0) return "in future";
  if (diff < 5_000) return "just now";
  for (const u of UNITS) {
    if (diff >= u.ms) {
      const v = Math.floor(diff / u.ms);
      return `${v}${u.name} ago`;
    }
  }
  return "just now";
}

export function RelativeTime({
  value,
}: {
  value: number | string | Date;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(i);
  }, []);
  return <span>{relativeTime(value)}</span>;
}
