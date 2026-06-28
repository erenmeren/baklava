"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { MonitorSmartphone } from "lucide-react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/components/workspace/relative-time";

interface Sess {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string;
  current: boolean;
}

/**
 * Turn a raw User-Agent into a human label like "Chrome on macOS" so a person
 * can actually recognise their devices — the whole point of "revoke any you
 * don't recognize". The raw UA stays available as a hover title.
 */
function describeDevice(ua: string): string {
  if (!ua) return "Unknown device";
  // Non-browser clients (curl, scripts, CLIs) have no Mozilla token — show the
  // product name they sent rather than inventing a browser.
  if (!/Mozilla\//.test(ua)) return ua.split(" ")[0] || ua;

  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";

  const os =
    /Windows/.test(ua) ? "Windows"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "";

  return os ? `${browser} on ${os}` : browser;
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
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate" title={s.userAgent}>
                      {describeDevice(s.userAgent)}
                    </p>
                    {s.current ? (
                      <Badge variant="secondary" className="shrink-0">This device</Badge>
                    ) : null}
                  </div>
                  <p
                    className="text-xs text-muted-foreground"
                    title={new Date(s.lastSeenAt).toLocaleString()}
                  >
                    Active {relativeTime(s.lastSeenAt)}
                  </p>
                </div>
                {!s.current ? (
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => revoke(s.id)}>
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
