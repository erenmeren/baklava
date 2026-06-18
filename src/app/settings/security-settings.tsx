"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff, TriangleAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

export function SecuritySettings() {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/auth/security", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { enabled?: boolean }) => setEnabled(d.enabled !== false))
      .catch(() => setEnabled(true));
  }, []);

  async function toggle(next: boolean) {
    const prev = enabled;
    setEnabled(next); // optimistic
    setSaving(true);
    try {
      const res = await fetch("/api/auth/security", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success(
        next ? "Password gate enabled" : "Password gate disabled",
      );
      // Re-render under the new gate state (enabling sends the user to /login).
      router.refresh();
    } catch (err) {
      setEnabled(prev ?? true); // revert
      toast.error(err instanceof Error ? err.message : "Could not update");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled === false ? (
            <ShieldOff className="size-4 text-amber-600" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
          Password protection
        </CardTitle>
        <CardDescription>
          Require a password to open this console. Turn this off only on a
          trusted private network — anyone who can reach the server will be able
          to read your connections and run queries.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3.5">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Require a password</p>
            <p className="text-xs text-muted-foreground">
              {enabled === false
                ? "Off — the console is open to anyone who can reach it."
                : "On — a password is needed to sign in."}
            </p>
          </div>
          {enabled === null ? (
            <Skeleton className="h-[18px] w-8 rounded-full" />
          ) : (
            <Switch
              checked={enabled}
              onCheckedChange={toggle}
              disabled={saving}
              aria-label="Require a password to access Baklava"
            />
          )}
        </div>

        {enabled === false ? (
          <p className="flex items-start gap-2 text-xs text-amber-600">
            <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
            Protection is off. Turning it back on will sign you out and ask for
            the password again.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
