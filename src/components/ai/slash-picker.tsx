"use client";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { ConnectionRecord } from "@/lib/connections/types";

/** A small command palette of AI-supported connections not already in the set. */
export function SlashPicker({
  candidates,
  onPick,
  onClose,
}: {
  candidates: ConnectionRecord[];
  onPick: (c: ConnectionRecord) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-full mb-1 left-0 w-72 rounded-lg border border-border bg-popover shadow-lg overflow-hidden z-20">
      <Command>
        <CommandInput placeholder="Add a connection…" autoFocus
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} />
        <CommandList>
          <CommandEmpty>No AI-capable connections.</CommandEmpty>
          <CommandGroup>
            {candidates.map((c) => (
              <CommandItem key={c.id} value={`${c.name} ${c.tech}`} onSelect={() => onPick(c)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/icons/${c.tech}.svg`} alt="" className="size-3.5 dark:brightness-0 dark:invert opacity-80" />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-[11px] text-muted-foreground">{c.tech}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}
