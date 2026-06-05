"use client";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConversationListItem {
  id: string;
  title: string;
  updatedAt: number;
}

export function ConversationList({
  rows,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  rows: ConversationListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <button
        onClick={onNew}
        className="m-2 inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-foreground/5"
      >
        <Plus className="size-3.5" /> New chat
      </button>
      <ul className="flex-1 min-h-0 overflow-y-auto px-1.5 space-y-0.5">
        {rows.length === 0 ? (
          <li className="px-2 py-1.5 text-xs text-muted-foreground">No conversations yet.</li>
        ) : null}
        {rows.map((r) => (
          <li
            key={r.id}
            className={cn(
              "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer",
              r.id === activeId ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5",
            )}
            onClick={() => onSelect(r.id)}
          >
            <MessageSquare className="size-3.5 shrink-0" />
            <span className="flex-1 truncate">{r.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(r.id); }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
              title="Delete conversation"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
