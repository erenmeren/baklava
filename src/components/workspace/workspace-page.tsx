interface WorkspacePageProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function WorkspacePage({
  title,
  description,
  actions,
  children,
}: WorkspacePageProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-6 py-4 border-b border-border/60 flex items-start justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground mt-0.5">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        ) : null}
      </header>
      <div className="flex-1 min-h-0 overflow-auto p-6">{children}</div>
    </div>
  );
}
