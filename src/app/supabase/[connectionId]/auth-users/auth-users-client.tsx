"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { RelativeTime } from "@/components/workspace/relative-time";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Mail,
  Phone,
  RefreshCcw,
  Search,
} from "lucide-react";

interface AuthUserSummary {
  id: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  providers: string[];
}

interface ApiResponse {
  users: AuthUserSummary[];
  page: number;
  perPage: number;
  total: number | null;
  nextPage: number | null;
  lastPage: number | null;
}

interface Props {
  connectionId: string;
}

const PER_PAGE = 50;

export function AuthUsersClient({ connectionId }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          perPage: String(PER_PAGE),
        });
        const res = await fetch(
          `/api/supabase/${connectionId}/auth-users?${params.toString()}`,
          { cache: "no-store" }
        );
        const body = await res.json();
        if (res.ok) setData(body as ApiResponse);
        else toast.error("Could not load", { description: body.error });
      } finally {
        setLoading(false);
      }
    },
    [connectionId]
  );

  useEffect(() => {
    load(page);
  }, [load, page]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const q = search.trim().toLowerCase();
    if (!q) return data.users;
    return data.users.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        u.phone?.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
    );
  }, [data, search]);

  const hasPrev = page > 1;
  const hasNext = data
    ? data.nextPage != null
      ? true
      : data.lastPage != null
        ? page < data.lastPage
        : data.users.length === PER_PAGE
    : false;

  return (
    <WorkspacePage
      title="Auth users"
      description={
        data
          ? data.total != null
            ? `${data.total} total · page ${data.page}${data.lastPage ? ` / ${data.lastPage}` : ""}`
            : `${data.users.length} on page ${data.page}`
          : undefined
      }
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => load(page)}
          disabled={loading}
        >
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter on this page…"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>
          <Pager
            page={page}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onChange={setPage}
            lastPage={data?.lastPage ?? null}
            disabled={loading}
          />
        </div>

        {data === null ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {data.users.length === 0
              ? "No users on this page."
              : "No users match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left w-[140px]">Phone</th>
                  <th className="px-3 py-2 text-left w-[180px]">Providers</th>
                  <th className="px-3 py-2 text-left w-[80px]">Confirmed</th>
                  <th className="px-3 py-2 text-left w-[110px]">Last sign-in</th>
                  <th className="px-3 py-2 text-left w-[90px]">Created</th>
                </tr>
              </thead>
              <tbody>
                {(filtered ?? []).map((u) => (
                  <UserRow key={u.id} user={u} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </WorkspacePage>
  );
}

function UserRow({ user }: { user: AuthUserSummary }) {
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2 min-w-0">
          <Mail className="size-3 text-muted-foreground shrink-0" />
          <span className="font-mono text-xs truncate">
            {user.email ?? <span className="text-muted-foreground">—</span>}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        {user.phone ? (
          <div className="flex items-center gap-1.5">
            <Phone className="size-3 text-muted-foreground shrink-0" />
            <span className="font-mono text-xs">{user.phone}</span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-1 flex-wrap">
          {user.providers.length === 0 ? (
            <span className="text-muted-foreground text-xs">—</span>
          ) : (
            user.providers.map((p) => (
              <Badge
                key={p}
                variant="outline"
                className="text-[9px] font-mono uppercase tracking-wider border-border/60"
              >
                {p}
              </Badge>
            ))
          )}
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        {user.emailConfirmedAt ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700 dark:text-emerald-400">
            <span className="size-1 rounded-full bg-emerald-500" />
            yes
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
            <span className="size-1 rounded-full bg-amber-500" />
            no
          </span>
        )}
      </td>
      <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
        {user.lastSignInAt ? (
          <RelativeTime value={user.lastSignInAt} />
        ) : (
          <span>—</span>
        )}
      </td>
      <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
        <RelativeTime value={user.createdAt} />
      </td>
    </tr>
  );
}

function Pager({
  page,
  hasPrev,
  hasNext,
  onChange,
  lastPage,
  disabled,
}: {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  onChange: (n: number) => void;
  lastPage: number | null;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => {
    setDraft(String(page));
  }, [page]);
  const commit = () => {
    const n = Math.max(1, Number(draft) || 1);
    const clamped = lastPage ? Math.min(lastPage, n) : n;
    if (clamped !== page) onChange(clamped);
  };
  return (
    <div className="inline-flex items-center gap-1 text-xs">
      <Button
        size="icon"
        variant="outline"
        className="size-7"
        disabled={!hasPrev || disabled}
        onClick={() => onChange(Math.max(1, page - 1))}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        inputMode="numeric"
        className="h-7 w-16 text-center font-mono text-xs"
      />
      <Button
        size="icon"
        variant="outline"
        className="size-7"
        disabled={!hasNext || disabled}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  );
}
