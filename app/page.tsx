"use client";

import { useEffect, useState } from "react";

interface QueryResponse {
  plan: { english: string; sql: string };
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncations: { connection: string; table: string; appliedLimit: number }[];
  attempts: 1 | 2;
  timingMs: { plan: number; fetch: number; execute: number; total: number };
}

interface BaklavaErrorShape {
  code: string;
  what: string;
  why: string;
  fix: string;
  docs: string;
}

interface HealthResponse {
  ok: boolean;
  hasAiKey: boolean;
  connections: { name: string; plugin: string }[];
}

function readToken(): string | null {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector('meta[name="baklava-token"]');
  return meta?.getAttribute("content") ?? null;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const token = readToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Baklava-Token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T | { error: BaklavaErrorShape };
  if (!res.ok || (json as { error?: BaklavaErrorShape }).error) {
    const err = (json as { error?: BaklavaErrorShape }).error;
    throw err ?? new Error(`HTTP ${res.status}`);
  }
  return json as T;
}

async function getJson<T>(path: string): Promise<T> {
  const token = readToken();
  const res = await fetch(path, {
    headers: token ? { "X-Baklava-Token": token } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export default function HomePage() {
  const [nl, setNl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<BaklavaErrorShape | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    getJson<HealthResponse>("/api/v1/health")
      .then(setHealth)
      .catch(() => setHealth({ ok: false, hasAiKey: false, connections: [] }));
  }, []);

  async function runQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!nl.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await postJson<QueryResponse>("/api/v1/query", { nl });
      setResult(data);
    } catch (err) {
      const e = err as BaklavaErrorShape | { message?: string };
      if ("code" in e) setError(e as BaklavaErrorShape);
      else
        setError({
          code: "E_INTERNAL",
          what: "Unexpected error.",
          why: e.message ?? String(err),
          fix: "Reload the page or check the server logs.",
          docs: "",
        });
    } finally {
      setLoading(false);
    }
  }

  const noConnections = health && health.connections.length === 0;
  const noKey = health && !health.hasAiKey;

  return (
    <main>
      <header>
        <h1>baklava</h1>
        <span className="tagline">
          one query, all your data — federated NL → SQL across connected sources
        </span>
      </header>

      {noKey && (
        <div className="no-key-banner">
          <strong>Anthropic API key not set.</strong> baklava uses Claude to
          translate your question into a query plan.{" "}
          <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">
            Get a key
          </a>{" "}
          and paste it on{" "}
          <a href="/settings">Settings</a>, or set <code>ANTHROPIC_API_KEY</code> and
          restart.
        </div>
      )}

      {noConnections && (
        <div className="no-key-banner">
          <strong>No connections configured.</strong> Add a Postgres or SQLite
          connection on <a href="/connections">Connections</a>, or run{" "}
          <code>npx baklava --demo</code> for a zero-setup tour.
        </div>
      )}

      <form className="input-row" onSubmit={runQuery}>
        <input
          type="text"
          autoFocus
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          placeholder='e.g. "show me users with paid orders in the last 24 hours"'
          disabled={loading}
        />
        <button type="submit" disabled={loading || !nl.trim()}>
          {loading ? "Planning..." : "Run"}
        </button>
      </form>

      {error && (
        <div className="error-card">
          <span className="label">{error.code}</span>
          <div>
            <strong>{error.what}</strong>
          </div>
          <div style={{ marginTop: 4 }}>
            <em>Why:</em> {error.why}
          </div>
          <div style={{ marginTop: 4 }}>
            <em>Fix:</em> {error.fix}
          </div>
          {error.docs && (
            <div style={{ marginTop: 4 }}>
              <a href={error.docs} target="_blank" rel="noreferrer">
                Docs →
              </a>
            </div>
          )}
        </div>
      )}

      {result && (
        <>
          <div className="plan-card">
            <span className="label">Plan ({result.attempts} attempt{result.attempts === 1 ? "" : "s"})</span>
            <div>{result.plan.english}</div>
            <pre>{result.plan.sql}</pre>
          </div>

          {result.truncations.length > 0 && (
            <div className="warn-card">
              <span className="label">Truncated</span>
              <div>
                Per-source row cap hit on{" "}
                {result.truncations
                  .map((t) => `${t.connection}.${t.table} (limit ${t.appliedLimit})`)
                  .join(", ")}
                . Add a filter to your question or raise the limit in Settings.
              </div>
            </div>
          )}

          <div className="results-meta">
            <span>
              <strong>{result.rowCount}</strong> rows
            </span>
            <span>
              plan <strong>{result.timingMs.plan}ms</strong>
            </span>
            <span>
              fetch <strong>{result.timingMs.fetch}ms</strong>
            </span>
            <span>
              execute <strong>{result.timingMs.execute}ms</strong>
            </span>
            <span>
              total <strong>{result.timingMs.total}ms</strong>
            </span>
          </div>

          {result.rows.length === 0 ? (
            <div className="empty-card">no rows</div>
          ) : (
            <div className="results">
              <table>
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell === null ? <em>NULL</em> : String(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
