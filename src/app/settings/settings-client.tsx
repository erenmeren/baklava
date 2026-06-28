"use client";
import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { KeyRound, ShieldCheck, Lock, UsersRound } from "lucide-react";
import { ProviderSettings } from "./provider-settings";
import { PermissionSettings } from "./permission-settings";
import { SecuritySettings } from "./security-settings";
import { ChangePasswordSettings } from "./change-password-settings";
import { ActiveSessions } from "./active-sessions";
import { UsersSettings } from "./users-settings";

type Role = "admin" | "member";
interface CurrentUser {
  id: string;
  username: string;
  role: Role;
}

export function SettingsClient() {
  const [me, setMe] = useState<CurrentUser | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/users/me", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { user: CurrentUser };
          setMe(data.user ?? null);
        }
      } catch {
        /* non-fatal — admin-only UI just won't appear */
      }
    })();
  }, []);

  const isAdmin = me?.role === "admin";

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-10 pb-24">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        {me ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{me.username}</span>
            <Badge variant={me.role === "admin" ? "secondary" : "outline"}>{me.role}</Badge>
          </p>
        ) : null}
        <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
          Connect a model provider and decide, per connection, what the
          assistant is allowed to do — and when it must ask first.
        </p>
      </header>

      <Tabs defaultValue="provider">
        <TabsList variant="line" className="mb-6">
          <TabsTrigger value="provider" className="gap-1.5">
            <KeyRound className="size-3.5" />
            Provider &amp; keys
          </TabsTrigger>
          <TabsTrigger value="permissions" className="gap-1.5">
            <ShieldCheck className="size-3.5" />
            Permissions
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5">
            <Lock className="size-3.5" />
            Security
          </TabsTrigger>
          {isAdmin ? (
            <TabsTrigger value="users" className="gap-1.5">
              <UsersRound className="size-3.5" />
              Users
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="provider" className="outline-none">
          <ProviderSettings />
        </TabsContent>
        <TabsContent value="permissions" className="outline-none">
          <PermissionSettings />
        </TabsContent>
        <TabsContent value="security" className="outline-none space-y-6">
          <SecuritySettings />
          <ActiveSessions />
          <ChangePasswordSettings />
        </TabsContent>
        {isAdmin ? (
          <TabsContent value="users" className="outline-none">
            <UsersSettings />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
