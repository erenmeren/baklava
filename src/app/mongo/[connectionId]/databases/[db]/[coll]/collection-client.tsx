"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { DocumentsTab } from "./documents-tab";
import { IndexesTab } from "./indexes-tab";
import { AggregateTab } from "./aggregate-tab";

interface Props {
  connectionId: string;
  dbName: string;
  collName: string;
}

type Tab = "documents" | "indexes" | "aggregate";

export function CollectionClient({ connectionId, dbName, collName }: Props) {
  const [tab, setTab] = useState<Tab>("documents");
  const tabs: { id: Tab; label: string }[] = [
    { id: "documents", label: "Documents" },
    { id: "indexes", label: "Indexes" },
    { id: "aggregate", label: "Aggregate" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-border/60">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
              tab === t.id
                ? "border-emerald-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "documents" ? (
        <DocumentsTab
          connectionId={connectionId}
          dbName={dbName}
          collName={collName}
        />
      ) : null}
      {tab === "indexes" ? (
        <IndexesTab
          connectionId={connectionId}
          dbName={dbName}
          collName={collName}
        />
      ) : null}
      {tab === "aggregate" ? (
        <AggregateTab
          connectionId={connectionId}
          dbName={dbName}
          collName={collName}
        />
      ) : null}
    </div>
  );
}
