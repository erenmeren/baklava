interface AggregateLike {
  errors?: unknown[];
}

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code;
    const msg = err.message?.trim();
    if (msg) {
      return code ? `${msg} (${code})` : msg;
    }
    if (code) return `${err.name}: ${code}`;
    const inner = (err as Error & AggregateLike).errors;
    if (Array.isArray(inner) && inner.length) {
      const parts = inner
        .map((e) => formatError(e))
        .filter((s) => s && s !== "Error");
      if (parts.length) return parts.join("; ");
    }
    return err.name || "Unknown error";
  }
  return String(err);
}
