"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KeyRound, ShieldCheck, Lock } from "lucide-react";
import { ProviderSettings } from "./provider-settings";
import { PermissionSettings } from "./permission-settings";
import { SecuritySettings } from "./security-settings";

export function SettingsClient() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-10 pb-24">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
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
        </TabsList>

        <TabsContent value="provider" className="outline-none">
          <ProviderSettings />
        </TabsContent>
        <TabsContent value="permissions" className="outline-none">
          <PermissionSettings />
        </TabsContent>
        <TabsContent value="security" className="outline-none">
          <SecuritySettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
