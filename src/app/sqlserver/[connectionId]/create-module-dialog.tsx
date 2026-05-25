"use client";

import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, MSSQL } from "@codemirror/lang-sql";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Eye,
  FileCode,
  FunctionSquare,
  Loader2,
  RotateCcw,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { editorTheme } from "@/lib/sql/editor-theme";
import { smartSqlCompletions } from "@/lib/sql/editor-completions";
import { SQLSERVER_KEYWORDS, SQLSERVER_TYPES } from "@/lib/sql/dialect-keywords";
import { useTheme } from "@/components/theme-provider";
import {
  DialogBrandStripe,
  ctaGlow,
} from "@/components/workspace/dialog-shell";

const KIND_ICON: Record<ModuleKind, typeof FileCode> = {
  view: Eye,
  proc: FileCode,
  scalar_fn: FunctionSquare,
  table_fn: FunctionSquare,
  trigger: Zap,
};

const KIND_BADGE: Record<ModuleKind, string> = {
  view: "VIEW",
  proc: "PROCEDURE",
  scalar_fn: "SCALAR FN",
  table_fn: "TABLE FN",
  trigger: "TRIGGER",
};

export type ModuleKind = "view" | "proc" | "scalar_fn" | "table_fn" | "trigger";

const KIND_LABEL: Record<ModuleKind, string> = {
  view: "view",
  proc: "stored procedure",
  scalar_fn: "scalar function",
  table_fn: "table-valued function",
  trigger: "trigger",
};

const KIND_TITLE: Record<ModuleKind, string> = {
  view: "Create view",
  proc: "Create stored procedure",
  scalar_fn: "Create scalar function",
  table_fn: "Create table-valued function",
  trigger: "Create trigger",
};

const KIND_PLACEHOLDER: Record<ModuleKind, string> = {
  view: "ActiveCustomers",
  proc: "GetCustomerOrders",
  scalar_fn: "FormatCurrency",
  table_fn: "GetOrdersByDate",
  trigger: "trg_Audit_Orders",
};

function scaffold(kind: ModuleKind, schema: string, name: string): string {
  const qname = `[${schema}].[${name || "NewObject"}]`;
  switch (kind) {
    case "view":
      return `CREATE VIEW ${qname} AS
SELECT
  -- columns
  *
FROM [${schema}].[SomeTable]
WHERE 1 = 1;
`;
    case "proc":
      return `CREATE PROCEDURE ${qname}
  @Param1 INT = NULL
AS
BEGIN
  SET NOCOUNT ON;

  -- body
  SELECT @Param1 AS Echo;
END;
`;
    case "scalar_fn":
      return `CREATE FUNCTION ${qname} (@Input INT)
RETURNS INT
AS
BEGIN
  -- body
  RETURN @Input;
END;
`;
    case "table_fn":
      return `CREATE FUNCTION ${qname} (@SinceDate DATETIME2)
RETURNS TABLE
AS
RETURN (
  SELECT *
  FROM [${schema}].[SomeTable]
  WHERE CreatedAt >= @SinceDate
);
`;
    case "trigger":
      return `CREATE TRIGGER ${qname}
ON [${schema}].[TargetTable]
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  -- inserted / deleted are the pseudo-tables of changed rows
  -- body
END;
`;
  }
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  database: string;
  schema: string;
  kind: ModuleKind;
  onCreated: () => void;
}

export function CreateModuleDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  schema,
  kind,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [body, setBody] = useState(() => scaffold(kind, schema, ""));
  // Tracks whether the user has typed in the editor — once they have, we stop
  // auto-syncing the scaffold so we don't blow away their edits when they
  // change the Name field.
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!open) {
      setName("");
      setBody(scaffold(kind, schema, ""));
      setEdited(false);
      setError(null);
      setBusy(false);
    }
  }, [open, kind, schema]);

  // Reflect Name → scaffold while the user hasn't manually edited the body.
  useEffect(() => {
    if (!edited) setBody(scaffold(kind, schema, name));
  }, [name, kind, schema, edited]);

  const extensions = useMemo(
    () => [
      sql({ dialect: MSSQL, upperCaseKeywords: false }),
      smartSqlCompletions({
        keywords: SQLSERVER_KEYWORDS,
        types: SQLSERVER_TYPES,
      }),
      editorTheme,
    ],
    [],
  );

  const resetScaffold = () => {
    setBody(scaffold(kind, schema, name));
    setEdited(false);
  };

  const submit = async () => {
    if (!body.trim()) return setError("Body cannot be empty");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/ddl`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sql: body }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(`${KIND_LABEL[kind][0].toUpperCase()}${KIND_LABEL[kind].slice(1)} created`, {
          description: name.trim() ? `${schema}.${name.trim()}` : undefined,
        });
        onOpenChange(false);
        onCreated();
      } else {
        setError(data.error || "Create failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const Icon = KIND_ICON[kind];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogBrandStripe tone="rose" />
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <span
              className="inline-flex size-5 items-center justify-center rounded-md bg-rose-500/10 text-rose-500"
              aria-hidden
            >
              <Icon className="size-3" />
            </span>
            {KIND_TITLE[kind]}
            <span className="ml-1 inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/[0.06] px-1.5 py-px text-[9px] font-mono uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400">
              {KIND_BADGE[kind]}
            </span>
          </DialogTitle>
          <DialogDescription>
            in{" "}
            <span className="font-mono text-foreground/80">{database}</span>
            <span className="mx-1 text-border" aria-hidden>·</span>
            <span className="font-mono text-foreground/80">{schema}</span>
            <span className="mx-1.5 text-border" aria-hidden>—</span>
            edit the T-SQL template, then Create.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
          <div className="space-y-1.5">
            <Label
              htmlFor="cm-name"
              className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground inline-flex items-center gap-1.5"
            >
              <span className="size-1 rounded-full bg-rose-500" aria-hidden />
              Name
            </Label>
            <Input
              id="cm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={KIND_PLACEHOLDER[kind]}
              spellCheck={false}
              autoFocus
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground inline-flex items-center gap-1.5">
                <span className="size-1 rounded-full bg-rose-500" aria-hidden />
                T-SQL
                {edited ? (
                  <span className="ml-1 text-rose-500/80 normal-case tracking-normal">
                    · edited
                  </span>
                ) : null}
              </Label>
              <Button
                size="xs"
                variant="ghost"
                onClick={resetScaffold}
                disabled={!edited}
                title="Reset to template"
                className="text-[10px] font-mono uppercase tracking-[0.14em]"
              >
                <RotateCcw className="size-3" />
                Reset template
              </Button>
            </div>
            <div className="flex-1 min-h-[260px] rounded-lg border border-border/60 overflow-hidden bg-card shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
              <CodeMirror
                value={body}
                onChange={(v) => {
                  setBody(v);
                  setEdited(true);
                }}
                extensions={extensions}
                theme={resolvedTheme === "dark" ? "dark" : "light"}
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLine: true,
                  foldGutter: false,
                  autocompletion: true,
                }}
                height="100%"
                className="h-full text-[12.5px]"
              />
            </div>
            <p className="text-[10.5px] leading-relaxed text-muted-foreground/80">
              Runs as a single batch against{" "}
              <span className="font-mono text-foreground/70">{database}</span>.
              The Name field keeps the scaffolded identifier in sync — the
              editor is the source of truth.
            </p>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not create</AlertTitle>
              <AlertDescription className="break-words font-mono text-xs">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !body.trim()}
            className={cn(
              "bg-rose-600 text-white hover:bg-rose-600/90 focus-visible:ring-rose-500/40",
              ctaGlow("rose"),
            )}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create {KIND_LABEL[kind]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
