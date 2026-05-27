"use client";

import { useEffect } from "react";

interface Props {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmOverlay({
  title,
  body,
  confirmLabel,
  onClose,
  onConfirm,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-red-500/30 bg-popover shadow-2xl shadow-red-950/30 overflow-hidden">
        <div className="px-5 py-3 border-b border-border/60 bg-red-500/5 font-mono flex items-center gap-2">
          <span className="uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-700 dark:text-red-300">
            destructive
          </span>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <div className="px-5 py-4 text-sm text-foreground/85 leading-relaxed">
          {body}
        </div>
        <div className="px-5 py-3 border-t border-border/60 bg-muted/30 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-border/60 px-3 py-1.5 text-xs font-mono hover:bg-foreground/5"
          >
            cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 text-xs font-mono"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
