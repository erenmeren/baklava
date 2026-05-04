import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { TechMeta } from "@/lib/tech-catalog";

interface TechPageShellProps {
  tech: TechMeta;
  children: React.ReactNode;
}

export function TechPageShell({ tech, children }: TechPageShellProps) {
  const Icon = tech.icon;
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-honey-glow opacity-50"
      />
      <div className="relative mx-auto max-w-6xl px-6 py-12 space-y-10">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-brand transition-colors"
          >
            <ArrowLeft className="size-3.5" /> Back to all
          </Link>
        </div>
        <header className="flex items-start gap-5">
          <div
            className={`inline-flex items-center justify-center size-14 rounded-xl bg-gradient-to-br ${tech.color} text-white shadow-md shadow-black/10 ring-1 ring-white/10`}
          >
            <Icon className="size-7" />
          </div>
          <div className="space-y-1.5 pt-1">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {tech.name}
            </h1>
            <p className="text-muted-foreground max-w-xl">{tech.description}</p>
          </div>
        </header>
        <div className="space-y-8">{children}</div>
      </div>
    </div>
  );
}
