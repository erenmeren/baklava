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
import { Loader2 } from "lucide-react";
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
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load the existing definition when editing, scaffold a stub when creating.
  useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      setCode(DEFAULT_SCAFFOLD(schema));
      return;
    }
    setLoading(true);
    setCode("");
    const url = `/api/postgres/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/functions/${encodeURIComponent(props.name)}?args=${encodeURIComponent(props.argSignature)}`;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load definition");
        setCode((data.definition as string) || "");
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

  const submit = async () => {
    if (!code.trim()) {
      toast.error("Body is required");
      return;
    }
    setSubmitting(true);
    try {
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
            onClick={submit}
            disabled={submitting || loading || !code.trim()}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
