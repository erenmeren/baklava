"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { EditorView } from "@codemirror/view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Check,
  Copy,
  Loader2,
  Pencil,
  RefreshCcw,
  Trash,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/components/theme-provider";
import { FunctionEditorDialog } from "../../../../../../function-editor-dialog";

interface FunctionInfo {
  name: string;
  language: string;
  returnType: string;
  arguments: string;
  kind: "function" | "procedure" | "aggregate" | "window";
}

interface Props {
  connectionId: string;
  db: string;
  schema: string;
  name: string;
  argSignature: string;
}

export function FunctionDetailClient({
  connectionId,
  db,
  schema,
  name,
  argSignature,
}: Props) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();

  const [meta, setMeta] = useState<FunctionInfo | null>(null);
  const [definition, setDefinition] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [defRes, listRes] = await Promise.all([
        fetch(
          `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/functions/${encodeURIComponent(name)}?args=${encodeURIComponent(argSignature)}`,
          { cache: "no-store" },
        ),
        fetch(
          `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/functions`,
          { cache: "no-store" },
        ),
      ]);
      const defData = await defRes.json();
      if (!defRes.ok) {
        toast.error("Could not load function", { description: defData.error });
      } else {
        setDefinition((defData.definition as string) ?? "");
      }
      const listData = await listRes.json();
      if (listRes.ok) {
        const fns = listData.functions as FunctionInfo[];
        const match = fns.find(
          (f) => f.name === name && f.arguments === argSignature,
        );
        setMeta(match ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId, db, schema, name, argSignature]);

  useEffect(() => {
    load();
  }, [load]);

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, upperCaseKeywords: false }),
      EditorView.theme({
        "&": { fontSize: "12.5px" },
        ".cm-scroller": { fontFamily: "var(--font-jetbrains-mono), monospace" },
        ".cm-content": { padding: "10px 0" },
      }),
      EditorView.editable.of(false),
    ],
    [],
  );

  const copy = async () => {
    if (!definition) return;
    try {
      await navigator.clipboard.writeText(definition);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  const drop = async () => {
    setDropping(true);
    try {
      const kind = meta?.kind === "procedure" ? "procedure" : "function";
      const url = `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/functions/${encodeURIComponent(name)}?args=${encodeURIComponent(argSignature)}&kind=${kind}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Drop failed", { description: data.error });
        return;
      }
      toast.success(`Dropped ${schema}.${name}`);
      router.push(`/postgres/${connectionId}`);
    } finally {
      setDropping(false);
    }
  };

  const kindLabel = meta?.kind === "procedure" ? "Procedure" : "Function";
  const editable = !meta || meta.kind === "function" || meta.kind === "procedure";

  return (
    <WorkspacePage
      title={
        <span className="font-mono">
          {schema}.{name}
          <span className="text-muted-foreground">({argSignature})</span>
        </span>
      }
      description={
        meta ? (
          <span className="text-xs">
            {kindLabel} · <span className="font-mono">{meta.language}</span> · returns{" "}
            <span className="font-mono">{meta.returnType}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            database <span className="font-mono">{db}</span>
          </span>
        )
      }
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => load()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="size-3.5" />
            )}
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditOpen(true)}
            disabled={!editable}
            title={
              editable
                ? "Edit body"
                : "Editing aggregates / window functions isn't supported here"
            }
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDropOpen(true)}
            className="text-destructive hover:text-destructive"
          >
            <Trash className="size-3.5" />
            Drop
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {meta ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <PropertyCard label="Kind" value={kindLabel.toLowerCase()} />
            <PropertyCard label="Language" value={meta.language} />
            <PropertyCard label="Returns" value={meta.returnType} />
            <PropertyCard
              label="Arguments"
              value={argSignature || "(none)"}
              mono
            />
          </div>
        ) : (
          <Skeleton className="h-20 w-full" />
        )}

        <div className="rounded-lg border border-border/60 bg-muted/30 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              definition · pg_get_functiondef
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={copy}
              disabled={!definition}
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {definition === null ? (
            <div className="p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <CodeMirror
              value={definition}
              extensions={extensions}
              theme={resolvedTheme === "dark" ? "dark" : "light"}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: false,
              }}
              editable={false}
              height="auto"
              maxHeight="60vh"
              className="text-[12.5px]"
            />
          )}
        </div>
      </div>

      {editable && meta ? (
        <FunctionEditorDialog
          mode="edit"
          open={editOpen}
          onOpenChange={setEditOpen}
          connectionId={connectionId}
          database={db}
          schema={schema}
          name={name}
          argSignature={argSignature}
          onSuccess={() => load()}
        />
      ) : null}

      <AlertDialog open={dropOpen} onOpenChange={(v) => !dropping && setDropOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Drop {kindLabel.toLowerCase()}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will run{" "}
              <span className="font-mono">
                DROP {kindLabel.toUpperCase()} {schema}.{name}({argSignature})
              </span>
              . This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dropping}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                drop();
              }}
              disabled={dropping}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {dropping ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Drop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

function PropertyCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
      <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground/80">
        {label}
      </div>
      <div
        className={
          mono
            ? "mt-1 text-[12.5px] font-mono text-foreground break-all"
            : "mt-1 text-[14px] text-foreground"
        }
      >
        {value}
      </div>
    </div>
  );
}
