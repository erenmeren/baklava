"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { MonitorSmartphone } from "lucide-react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface Sess {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string;
  current: boolean;
}

export function ActiveSessions() {
  const [sessions, setSessions] = useState<Sess[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/sessions", { cache: "no-store" });
      const data = (await res.json()) as { sessions: Sess[] };
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function revoke(id: string) {
    const res = await fetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Session revoked");
      void refresh();
    } else {
      toast.error("Could not revoke session");
    }
  }

  async function revokeOthers() {
    const res = await fetch("/api/auth/sessions/revoke-others", { method: "POST" });
    if (res.ok) {
      toast.success("Signed out other sessions");
      void refresh();
    } else {
      toast.error("Could not sign out other sessions");
    }
  }

  const others = (sessions ?? []).filter((s) => !s.current).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="size-4" />
          Active sessions
        </CardTitle>
        <CardDescription>
          Devices currently signed in. Revoke any you don&apos;t recognize.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions === null ? (
          <Skeleton className="h-16 w-full" />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {s.userAgent}
                    {s.current ? (
                      <span className="ml-2 text-xs text-emerald-600">this device</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    last active {new Date(s.lastSeenAt).toLocaleString()}
                  </p>
                </div>
                {!s.current ? (
                  <Button size="sm" variant="outline" onClick={() => revoke(s.id)}>
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {others > 0 ? (
          <Button size="sm" variant="outline" onClick={revokeOthers}>
            Sign out all other sessions
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
