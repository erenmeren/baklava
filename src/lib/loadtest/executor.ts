export interface Progress {
  /** One line of k6 stderr (live progress / logs). */
  line: string;
}

export interface RunOpts {
  /** Secret env vars passed to the k6 container (referenced as __ENV.*). */
  env: Record<string, string>;
  signal?: AbortSignal;
}

export interface RawRunOutput {
  /** Parsed k6 handleSummary `data` object. */
  summary: unknown;
  /** Container exit code. 0 = pass, 99 = thresholds failed (NOT an error). */
  exitCode: number;
}

export interface Executor {
  run(
    script: string,
    opts: RunOpts,
    onProgress: (p: Progress) => void,
  ): Promise<RawRunOutput>;
}
