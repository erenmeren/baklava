interface AggregateLike {
  errors?: unknown[];
}

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    // AI SDK APICallError (and other HTTP-style errors) carry an HTTP status
    // code plus the provider's response body — that's where the real reason
    // lives (401 invalid key, 404 unknown model, 502 upstream). Without this,
    // they all collapse to a vague message and the caller can't tell them apart.
    const http = err as Error & { statusCode?: number; responseBody?: unknown };
    if (typeof http.statusCode === "number") {
      const body =
        typeof http.responseBody === "string" ? http.responseBody.trim().slice(0, 500) : "";
      const detail = body || err.message?.trim() || err.name || "request failed";
      return `HTTP ${http.statusCode}: ${detail}`;
    }
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
