"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Column-type input for the Create-Table dialogs. The user can type freely
 * (so `varchar(50)`, `decimal(10,2)`, custom types all work), and the chevron
 * always opens a popover with every preset listed — unfiltered, regardless
 * of what's already in the input. Replaces `<input list>` + `<datalist>`,
 * which native browsers filter against the current value (so you couldn't
 * see all options once a value was set).
 */
export function TypeCombobox({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("relative", className)}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="font-mono text-xs pr-7"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Show all types"
              title="Show all types"
              className={cn(
                "absolute right-0 top-0 h-full px-1.5 flex items-center justify-center",
                "text-muted-foreground hover:text-foreground transition-colors",
              )}
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          }
        />
        <PopoverContent align="end" className="w-56 p-1">
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Types
          </div>
          <ul className="max-h-72 overflow-auto">
            {options.map((opt) => {
              const isCurrent = opt === value;
              return (
                <li key={opt}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left font-mono text-xs transition-colors",
                      isCurrent
                        ? "bg-foreground/10 text-foreground"
                        : "text-foreground/80 hover:bg-foreground/5",
                    )}
                  >
                    <span className="truncate">{opt}</span>
                    {isCurrent ? (
                      <Check className="size-3 shrink-0" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
