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
  name: string;
}

type Props = CreateProps | EditProps;

const SCAFFOLD = (schema: string) => `CREATE OR REPLACE VIEW ${schema}.example_view AS
SELECT
  1 AS id,
  'example' AS name;
`;

export function ViewEditorDialog(props: Props) {
  const { open, onOpenChange, connectionId, database, schema, onSuccess, mode } =
    props;
  const { resolvedTheme } = useTheme();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load the existing definition on edit; scaffold a stub on create.
  useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      setCode(SCAFFOLD(schema));
      return;
    }
    setLoading(true);
    setCode("");
    const url = `/api/postgres/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/views/${encodeURIComponent(props.name)}`;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load view");
        const def = (data.definition as string)?.trim() ?? "";
        // pg_get_viewdef returns just the SELECT body; wrap so the user has
        // a complete CREATE OR REPLACE block to edit.
        setCode(
          `CREATE OR REPLACE VIEW ${schema}.${props.name} AS\n${def}\n`,
        );
      })
      .catch((err) => {
        toast.error("Could not load view", {
          description: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => setLoading(false));
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
      toast.error("View definition is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/postgres/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/views`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sql: code }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          mode === "create" ? "Could not create view" : "Could not save view",
          { description: data.error },
        );
        return;
      }
      toast.success(mode === "create" ? "View created" : "View saved");
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
              ? "New view"
              : `Edit view "${schema}.${props.name}"`}
          </DialogTitle>
          <DialogDescription>
            Write a complete{" "}
            <span className="font-mono">CREATE [OR REPLACE] VIEW</span>{" "}
            statement.{" "}
            {mode === "edit"
              ? "OR REPLACE is allowed only when columns and types stay the same — to change those, drop first."
              : null}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/60 overflow-hidden bg-card">
          {loading ? (
            <div className="p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-5/6" />
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
              height="340px"
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
