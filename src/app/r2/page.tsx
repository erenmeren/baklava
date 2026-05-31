"use client";

import { useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionsList } from "@/components/connections-list";
import { connectionSummaries } from "@/lib/connections/summaries";
import { R2Form } from "./r2-form";

export default function R2Page() {
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<
    import("@/lib/connections/types").ConnectionRecord | null
  >(null);
  const [refresh, setRefresh] = useState(0);

  return (
    <div className="mx-auto max-w-2xl px-6 pt-8 pb-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cloudflare R2</h1>
          <p className="text-sm text-muted-foreground">
            Object storage — manage your R2 connections
          </p>
        </div>
        {view === "list" && (
          <Button size="sm" onClick={() => setView("form")}>
            <Plus className="size-3.5" />
            New connection
          </Button>
        )}
        {view === "form" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setView("list");
              setEditing(null);
            }}
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Button>
        )}
      </div>

      {view === "list" ? (
        <ConnectionsList
          tech="r2"
          refreshKey={refresh}
          renderSummary={connectionSummaries.r2}
          onEdit={(r) => {
            setEditing(r);
            setView("form");
          }}
          emptyState={
            <span>
              No saved connections yet — click{" "}
              <span className="font-medium text-foreground">New connection</span>{" "}
              to add one.
            </span>
          }
        />
      ) : (
        <R2Form
          initial={editing ?? undefined}
          onSaved={() => {
            setRefresh((n) => n + 1);
            setEditing(null);
            setView("list");
          }}
        />
      )}
    </div>
  );
}
