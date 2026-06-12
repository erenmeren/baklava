"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { LoadTestList } from "@/components/loadtest-list";
import { LoadTestForm } from "@/app/loadtest/loadtest-form";
import type { PublicLoadTest } from "@/lib/loadtest/store";

export function LoadTestSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<PublicLoadTest | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (open) { setView("list"); setEditing(null); }
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="p-5 pb-4 border-b border-border/60">
          <SheetTitle className="text-base">Load Testing</SheetTitle>
          <SheetDescription className="text-xs">Define and run k6 load tests against any REST API.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {view === "list" ? (
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Saved tests</h3>
                <Button size="sm" onClick={() => { setEditing(null); setView("form"); }}>
                  <Plus className="size-3.5" />
                  New test
                </Button>
              </div>
              <LoadTestList refreshKey={refresh} onEdit={(t) => { setEditing(t); setView("form"); }} />
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <Button size="sm" variant="ghost" className="-ml-2" onClick={() => { setView("list"); setEditing(null); }}>
                <ArrowLeft className="size-3.5" />
                Back to tests
              </Button>
              <LoadTestForm
                initial={editing ?? undefined}
                onSaved={() => { setRefresh((n) => n + 1); setEditing(null); setView("list"); }}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
