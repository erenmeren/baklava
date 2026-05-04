import { TechGrid } from "@/components/tech-grid";

export default function Home() {
  return (
    <div className="relative">
      {/* Honey radial glow + dot grid — sits behind everything in the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-honey-glow"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-grid opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />

      <div className="relative mx-auto max-w-6xl px-6 pt-16 pb-20 sm:pt-24 space-y-16">
        <section className="space-y-6 max-w-3xl">
          <div
            className="reveal-up inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur"
            style={{ ["--delay" as string]: "0ms" }}
          >
            <span className="size-1.5 rounded-full bg-brand status-pulse" />
            Open source ops console
          </div>
          <h1
            className="reveal-up text-balance text-5xl sm:text-6xl font-semibold tracking-tight leading-[1.05]"
            style={{ ["--delay" as string]: "80ms" }}
          >
            One console for every{" "}
            <span className="font-display text-brand">layer</span> of your
            stack.
          </h1>
          <p
            className="reveal-up text-pretty text-muted-foreground max-w-2xl text-base sm:text-lg leading-relaxed"
            style={{ ["--delay" as string]: "160ms" }}
          >
            Stop juggling separate UIs for Docker, Kafka, PostgreSQL and
            friends. Configure a connection, test it, and you&rsquo;re in.
            Everything stays in memory.
          </p>
          <div
            className="reveal-up flex flex-wrap items-center gap-3 text-xs text-muted-foreground font-mono"
            style={{ ["--delay" as string]: "240ms" }}
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-emerald-500" />
              dockerode
            </span>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-orange-500" />
              kafkajs
            </span>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-indigo-500" />
              pg
            </span>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span>more soon</span>
          </div>
        </section>

        <section
          className="reveal-up space-y-5"
          style={{ ["--delay" as string]: "320ms" }}
        >
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-[0.18em]">
              Integrated technologies
            </h2>
            <span className="text-xs text-muted-foreground/70 font-mono">
              click to enter workspace
            </span>
          </div>
          <TechGrid />
        </section>

        <section
          className="reveal-up pt-6 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground"
          style={{ ["--delay" as string]: "480ms" }}
        >
          <span>
            Connections live <span className="font-mono">in memory</span> —
            never persisted to disk.
          </span>
          <span className="font-display italic text-brand/80">
            layer by layer.
          </span>
        </section>
      </div>
    </div>
  );
}
