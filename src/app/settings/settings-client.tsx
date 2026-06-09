"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KeyRound, ShieldCheck } from "lucide-react";
import { ProviderSettings } from "./provider-settings";
import { PermissionSettings } from "./permission-settings";

export function SettingsClient() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-10 pb-24">
      {/* Editorial header — mono eyebrow over a serif display title. */}
      <header
        className="mb-9"
        style={{ animation: "settings-rise 0.5s both" }}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand">
          AI configuration
        </p>
        <h1 className="mt-1.5 font-display text-[3.25rem] leading-[0.95] italic text-foreground">
          Settings
        </h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          Connect a model provider and decide, per connection, what the
          assistant is allowed to do — and when it must ask first.
        </p>
      </header>

      <div style={{ animation: "settings-rise 0.5s both", animationDelay: "0.06s" }}>
        <Tabs defaultValue="provider">
          <TabsList variant="line" className="mb-6 border-b border-border/60">
            <TabsTrigger value="provider" className="gap-1.5">
              <KeyRound className="size-3.5" />
              Provider &amp; keys
            </TabsTrigger>
            <TabsTrigger value="permissions" className="gap-1.5">
              <ShieldCheck className="size-3.5" />
              Permissions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="provider" className="outline-none">
            <ProviderSettings />
          </TabsContent>
          <TabsContent value="permissions" className="outline-none">
            <PermissionSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
