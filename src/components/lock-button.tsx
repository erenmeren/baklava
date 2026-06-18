"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

export function LockButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function lock() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* cookie is httpOnly; nothing to clear client-side — just navigate */
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={lock}
      disabled={busy}
      title="Lock console"
      aria-label="Lock console"
      className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-50"
    >
      <LogOut className="size-4" />
    </button>
  );
}
