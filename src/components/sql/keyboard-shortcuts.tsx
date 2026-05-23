"use client";

import { useCallback, useEffect, useState } from "react";
import { Keyboard, Play, AlignLeft, Sparkles, MessageSquare, Wand2, Undo2, Redo2 } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/** True on macOS — drives ⌘ vs Ctrl labelling. Resolves on the client only. */
export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    const p =
      (typeof navigator !== "undefined" &&
        ((navigator as Navigator & { userAgentData?: { platform?: string } })
          .userAgentData?.platform ||
          navigator.platform ||
          navigator.userAgent)) ||
      "";
    setIsMac(/mac|iphone|ipad/i.test(p));
  }, []);
  return isMac;
}

/** Compact inline hint for the Run button etc. (e.g. "⌘↵" / "Ctrl+↵"). */
export function runHint(isMac: boolean): string {
  return isMac ? "⌘↵" : "Ctrl+↵";
}

/** Decide whether a keystroke is happening inside an editable target. We don't
 *  want `?` to open the palette while the user is typing it into the editor or
 *  a filter input. */
function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") {
    return true;
  }
  if (t.isContentEditable) return true;
  // CodeMirror renders its editable area as a div[contenteditable] inside .cm-content
  if (t.closest(".cm-editor")) return true;
  return false;
}

interface Props {
  /** Optional callbacks — when present, selecting the item runs the action. */
  onRun?: () => void;
  onFormat?: () => void;
  onExplain?: () => void;
  className?: string;
  /** Smaller (status-line) appearance instead of the default toolbar size. */
  compact?: boolean;
}

/**
 * Shortcut cheatsheet built on shadcn's Command (cmdk). Renders as a keyboard
 * icon button that opens a searchable palette of shortcuts. Also opens from
 * anywhere on the page with `?`. When the editor passes `onRun` / `onFormat`
 * / `onExplain`, selecting the matching item also fires the action.
 */
export function ShortcutCheatsheet({
  onRun,
  onFormat,
  onExplain,
  className,
  compact = false,
}: Props) {
  const isMac = useIsMac();
  const mod = isMac ? "⌘" : "Ctrl";
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const wrap = (fn?: () => void) => () => {
    close();
    fn?.();
  };

  // Global `?` to open the cheatsheet (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?") return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
          compact ? "size-5" : "size-8",
          className,
        )}
      >
        <Keyboard className={compact ? "size-3" : "size-4"} />
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Keyboard shortcuts"
        description="Search and trigger SQL-editor actions"
      >
        <CommandInput placeholder="Search shortcuts…" />
        <CommandList>
          <CommandEmpty>No matching shortcut.</CommandEmpty>

          <CommandGroup heading="SQL editor">
            <CommandItem
              keywords={["run", "execute", "query", "selection"]}
              onSelect={wrap(onRun)}
            >
              <Play className="size-4" />
              <span>Run query</span>
              <span className="ml-1 text-muted-foreground">
                runs selection if any
              </span>
              <CommandShortcut>{mod} ↵</CommandShortcut>
            </CommandItem>
            <CommandItem
              keywords={["format", "prettify", "tidy"]}
              onSelect={wrap(onFormat)}
            >
              <AlignLeft className="size-4" />
              <span>Format SQL</span>
              <CommandShortcut>{mod} ⇧ F</CommandShortcut>
            </CommandItem>
            <CommandItem
              keywords={["explain", "plan", "analyze"]}
              onSelect={wrap(onExplain)}
            >
              <Sparkles className="size-4" />
              <span>Explain</span>
              <CommandShortcut>{mod} E</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading="Editor (CodeMirror)">
            <CommandItem
              keywords={["comment", "uncomment", "toggle"]}
              onSelect={close}
            >
              <MessageSquare className="size-4" />
              <span>Toggle comment</span>
              <CommandShortcut>{mod} /</CommandShortcut>
            </CommandItem>
            <CommandItem
              keywords={["autocomplete", "completion", "intellisense"]}
              onSelect={close}
            >
              <Wand2 className="size-4" />
              <span>Autocomplete</span>
              <CommandShortcut>Ctrl Space</CommandShortcut>
            </CommandItem>
            <CommandItem keywords={["undo"]} onSelect={close}>
              <Undo2 className="size-4" />
              <span>Undo</span>
              <CommandShortcut>{mod} Z</CommandShortcut>
            </CommandItem>
            <CommandItem keywords={["redo"]} onSelect={close}>
              <Redo2 className="size-4" />
              <span>Redo</span>
              <CommandShortcut>{mod} ⇧ Z</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading="Help">
            <CommandItem keywords={["help", "shortcuts", "cheatsheet"]} onSelect={close}>
              <Keyboard className="size-4" />
              <span>Show this cheatsheet</span>
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
