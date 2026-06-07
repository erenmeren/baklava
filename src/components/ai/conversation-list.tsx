"use client";
import { useState } from "react";
import { Plus, Trash2, MessageSquare, Pencil } from "lucide-react";
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
  onRename,
}: {
  rows: ConversationListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (item: ConversationListItem) => {
    setEditingId(item.id);
    setDraft(item.title);
  };
  const commit = () => {
    if (editingId) {
      const t = draft.trim();
      // Only persist a real change; empty titles are ignored.
      const current = rows.find((r) => r.id === editingId);
      if (t && t !== current?.title) onRename(editingId, t);
    }
    setEditingId(null);
  };

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
        {rows.map((r) => {
          const editing = editingId === r.id;
          return (
            <li
              key={r.id}
              className={cn(
                "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                editing ? "" : "cursor-pointer",
                r.id === activeId ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5",
              )}
              onClick={() => { if (!editing) onSelect(r.id); }}
            >
              <MessageSquare className="size-3.5 shrink-0" />
              {editing ? (
                <input
                  autoFocus
                  value={draft}
                  maxLength={80}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commit(); }
                    else if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
                  }}
                  className="flex-1 min-w-0 rounded border border-border bg-background px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-brand"
                />
              ) : (
                <span
                  className="flex-1 truncate"
                  onDoubleClick={(e) => { e.stopPropagation(); startEdit(r); }}
                  title="Double-click to rename"
                >
                  {r.title}
                </span>
              )}
              {editing ? null : (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                    title="Rename conversation"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(r.id); }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    title="Delete conversation"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
