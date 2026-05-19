"use client";

import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { EditorView } from "@codemirror/view";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/components/theme-provider";

interface BaseProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  database: string;
  schema: string;
  onSuccess: () => void;
}

interface CreateProps extends BaseProps {
  mode: "create";
}

interface EditProps extends BaseProps {
  mode: "edit";
  /** Existing function name (without args). Used to fetch its definition. */
  name: string;
  /** Arg signature string (e.g. "integer, text") used to disambiguate overloads. */
  argSignature: string;
}

type Props = CreateProps | EditProps;

const DEFAULT_SCAFFOLD = (schema: string) => `CREATE OR REPLACE FUNCTION ${schema}.example(
  arg_a integer,
  arg_b text DEFAULT ''
)
RETURNS integer
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN arg_a * length(arg_b);
END;
$function$;
`;

export function FunctionEditorDialog(props: Props) {
  const { open, onOpenChange, connectionId, database, schema, onSuccess, mode } =
    props;
  const { resolvedTheme } = useTheme();

  const [code, setCode] = useState("");
  const [originalCode, setOriginalCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [diffWarning, setDiffWarning] = useState<{
    serverCode: string;
    hunks: DiffHunk[];
  } | null>(null);

  // Load the existing definition when editing, scaffold a stub when creating.
  useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      setCode(DEFAULT_SCAFFOLD(schema));
      return;
    }
    setLoading(true);
    setCode("");
    setOriginalCode("");
    const url = `/api/postgres/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/functions/${encodeURIComponent(props.name)}?args=${encodeURIComponent(props.argSignature)}`;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load definition");
        const def = (data.definition as string) || "";
        setCode(def);
        setOriginalCode(def);
      })
      .catch((err) => {
        toast.error("Could not load definition", {
          description: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => setLoading(false));
    // mode === edit guarantees props.name/argSignature exist
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, connectionId, database, schema]);

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, upperCaseKeywords: false }),
      EditorView.theme({
        "&": { height: "100%", fontSize: "12.5px" },
        ".cm-scroller": { fontFamily: "var(--font-jetbrains-mono), monospace" },
        ".cm-content": { padding: "10px 0" },
      }),
    ],
    [],
  );

  const submit = async (force = false) => {
    if (!code.trim()) {
      toast.error("Body is required");
      return;
    }
    setSubmitting(true);
    try {
      // Stale-source check: re-fetch the current definition before saving
      // and warn if it has drifted from what we initially loaded. Skipped
      // on creates (nothing to drift from) and when the user confirms
      // overwrite from the diff dialog.
      if (mode === "edit" && !force) {
        const url = `/api/postgres/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/functions/${encodeURIComponent(props.name)}?args=${encodeURIComponent(props.argSignature)}`;
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            const serverCode = (data.definition as string) || "";
            if (serverCode && serverCode !== originalCode) {
              const hunks = diffLines(serverCode, code);
              setDiffWarning({ serverCode, hunks });
              return;
            }
          }
        } catch {
          // Network blip — proceed; the actual CREATE OR REPLACE will surface
          // any real problem.
        }
      }

      const res = await fetch(
        `/api/postgres/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/functions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sql: code }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          mode === "create"
            ? "Could not create function"
            : "Could not update function",
          { description: data.error },
        );
        return;
      }
      toast.success(mode === "create" ? "Function created" : "Function saved");
      onSuccess();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? "New function"
              : `Edit function "${schema}.${props.name}(${props.argSignature})"`}
          </DialogTitle>
          <DialogDescription>
            Write a complete{" "}
            <span className="font-mono">CREATE [OR REPLACE] FUNCTION</span>{" "}
            statement. To change a function&apos;s signature, drop it first.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/60 overflow-hidden bg-card">
          {loading ? (
            <div className="p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <CodeMirror
              value={code}
              onChange={setCode}
              extensions={extensions}
              theme={resolvedTheme === "dark" ? "dark" : "light"}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLine: true,
                foldGutter: true,
                autocompletion: true,
                bracketMatching: true,
                closeBrackets: true,
                indentOnInput: true,
              }}
              height="380px"
              className="text-[12.5px]"
            />
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => submit(false)}
            disabled={submitting || loading || !code.trim()}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>

        {diffWarning ? (
          <DiffDialog
            hunks={diffWarning.hunks}
            onCancel={() => setDiffWarning(null)}
            onReload={() => {
              setCode(diffWarning.serverCode);
              setOriginalCode(diffWarning.serverCode);
              setDiffWarning(null);
              toast.info("Reloaded current definition from the database");
            }}
            onOverwrite={async () => {
              setDiffWarning(null);
              await submit(true);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ─── Minimal line diff ────────────────────────────────────────────────────

type DiffHunk =
  | { kind: "eq"; line: string }
  | { kind: "add"; line: string }
  | { kind: "del"; line: string };

/**
 * Line-level diff via LCS. Output is a flat sequence of equal / add / del
 * lines suitable for a unified-style viewer. O(n*m) — fine for source files
 * up to a few thousand lines, which covers any reasonable pg function.
 */
function diffLines(a: string, b: string): DiffHunk[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  // LCS table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        A[i] === B[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ kind: "eq", line: A[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "del", line: A[i] });
      i++;
    } else {
      out.push({ kind: "add", line: B[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", line: A[i++] });
  while (j < m) out.push({ kind: "add", line: B[j++] });
  return out;
}

function DiffDialog({
  hunks,
  onCancel,
  onReload,
  onOverwrite,
}: {
  hunks: DiffHunk[];
  onCancel: () => void;
  onReload: () => void;
  onOverwrite: () => void;
}) {
  const added = hunks.filter((h) => h.kind === "add").length;
  const deleted = hunks.filter((h) => h.kind === "del").length;
  return (
    <Dialog open onOpenChange={(v) => v || onCancel()}>
      <DialogContent className="sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" />
            Definition has changed in the database
          </DialogTitle>
          <DialogDescription>
            Someone (or something) modified this function after you opened
            the editor.{" "}
            <span className="font-mono">
              +{added} / −{deleted}
            </span>{" "}
            lines vs your starting point. Pick how to resolve.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/60 bg-card max-h-[360px] overflow-auto font-mono text-[11.5px]">
          {hunks.map((h, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-2 px-2 whitespace-pre-wrap break-words leading-relaxed",
                h.kind === "add" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                h.kind === "del" && "bg-rose-500/10 text-rose-700 dark:text-rose-300",
              )}
            >
              <span className="w-4 select-none text-muted-foreground">
                {h.kind === "add" ? "+" : h.kind === "del" ? "−" : " "}
              </span>
              <span className="flex-1">{h.line || " "}</span>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-1">
          <Button variant="ghost" onClick={onCancel}>
            Back to editor
          </Button>
          <Button variant="outline" onClick={onReload}>
            Discard my edits, reload from DB
          </Button>
          <Button variant="destructive" onClick={onOverwrite}>
            Overwrite (apply my version)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
