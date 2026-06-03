import { techIconUrl, type TechMeta } from "@/lib/tech-catalog";
import { RecordVisit } from "@/components/command-palette/record-visit";

interface WorkspaceShellProps {
  tech: TechMeta;
  connectionName: string;
  connectionId: string;
  subtitle?: string;
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export function WorkspaceShell({
  tech,
  connectionName,
  connectionId,
  subtitle,
  sidebar,
  children,
}: WorkspaceShellProps) {
  return (
    <div className="flex h-[calc(100vh-3rem)] w-full">
      <RecordVisit connectionId={connectionId} />
      <aside className="w-64 shrink-0 border-r border-border/60 flex flex-col bg-sidebar">
        <div className="px-4 py-3.5 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div
              className={`inline-flex items-center justify-center size-8 rounded-lg bg-gradient-to-br ${tech.color} text-white shrink-0 ring-1 ring-white/10 shadow-sm shadow-black/10`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={techIconUrl(tech)}
                alt=""
                aria-hidden
                draggable={false}
                className="size-4 select-none brightness-0 invert"
              />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm leading-tight truncate">
                {connectionName}
              </div>
              {subtitle ? (
                <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                  {subtitle}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2.5">{sidebar}</div>
        <div className="p-3 border-t border-border/60 flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-brand status-pulse" />
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            in-memory · live
          </span>
        </div>
      </aside>
      <section className="flex-1 min-w-0 overflow-hidden bg-background">
        {children}
      </section>
    </div>
  );
}
