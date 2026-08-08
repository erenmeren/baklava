import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockFetch } from "@/test/fetch-mock";

// Unlike the Postgres and MySQL editors, this component does not import
// next/navigation at all — confirmed by reading query-editor-client.tsx — so
// no router mock is needed here.

// CodeMirror needs layout APIs happy-dom doesn't provide. Mock it with a
// controlled <textarea> — this protects the surrounding workspace, not
// CodeMirror itself. forwardRef avoids React's "function components cannot
// be given refs" console.error for the `ref={cmRef}` prop.
vi.mock("@uiw/react-codemirror", () => ({
  default: React.forwardRef(function CodeMirrorMock(
    { value, onChange }: { value: string; onChange?: (v: string) => void },
    _ref: React.Ref<unknown>,
  ) {
    // Referenced (not forwarded) only to satisfy no-unused-vars — the mock
    // doesn't need to expose an imperative handle for these tests.
    void _ref;
    return (
      <textarea
        data-testid="sql-editor"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  }),
}));

import { QueryEditorClient } from "./query-editor-client";

// Props are { connectionId, db, queryId } — read from the component's own
// `interface Props`. The brief's draft guessed a `database` prop name; the
// real prop is `db` (mirroring the Postgres/MySQL editors).
//
// Response shape matches POST /api/sqlserver/[id]/query
// (src/app/api/sqlserver/[id]/query/route.ts), which returns whatever
// runSqlServerScript resolves to: `{ batches: BatchResult[], totalDurationMs }`
// where each BatchResult is `{ sql, resultSets: ResultSet[], rowsAffected,
// messages, durationMs, error? }` and each ResultSet is `{ fields, rows,
// rowCount, truncated }`. The brief's draft used a flat `batches:
// [{columns,...}]` shape, which doesn't match — batches nest `resultSets`.
const OK = {
  batches: [
    {
      sql: "select 1",
      resultSets: [
        {
          fields: ["id", "email"],
          rows: [[1, "a@example.com"]],
          rowCount: 1,
          truncated: false,
        },
      ],
      rowsAffected: [],
      messages: [],
      durationMs: 12,
    },
  ],
  totalDurationMs: 12,
};

let restore: () => void;

beforeEach(() => {
  restore = mockFetch({
    "/query": OK,
    // useSchemaCompletions fires this on mount to feed autocomplete; its
    // failure path is swallowed internally (sets completions to null), but
    // mock it anyway so a passing run doesn't depend on an internally
    // caught rejection.
    "schemas/dbo/columns": { tables: [] },
  });
});

afterEach(() => restore());

function renderIt() {
  return render(<QueryEditorClient connectionId="c1" db="appdb" queryId="q1" />);
}

async function run(sql: string) {
  fireEvent.change(screen.getByTestId("sql-editor"), { target: { value: sql } });
  fireEvent.click(screen.getByRole("button", { name: /run|execute/i }));
}

describe("sqlserver QueryEditorClient (characterization)", () => {
  it("renders the editor and a run control", async () => {
    renderIt();
    expect(await screen.findByTestId("sql-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run|execute/i })).toBeInTheDocument();
  });

  it("renders the result grid after a successful run", async () => {
    renderIt();
    await run("select 1");
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
  });

  it("shows the row count and duration footer after a run", async () => {
    renderIt();
    await run("select 1");
    // "1 row" comes from <ResultActions> inside <ResultGrid>.
    expect(await screen.findByText(/1 row/i)).toBeInTheDocument();
    // The status line renders "done · 1 batch · 12ms" as a single string
    // expression (one text node), unlike Postgres/MySQL's split <strong>s.
    expect(screen.getByText(/12\s*ms/i)).toBeInTheDocument();
  });

  it("renders the error text rather than an empty grid on failure", async () => {
    restore();
    // Per-batch failures land in `batches[i].error`, not a top-level
    // `error` (that's reserved for connection-level failures — see
    // route.ts:38 and execute()'s `data.error && !data.batches` check).
    restore = mockFetch({
      "/query": {
        batches: [
          {
            sql: "select * from nope",
            resultSets: [],
            rowsAffected: [],
            messages: [],
            durationMs: 5,
            error: 'Invalid object name \'nope\'.',
          },
        ],
        totalDurationMs: 5,
      },
      "schemas/dbo/columns": { tables: [] },
    });
    renderIt();
    await run("select * from nope");
    expect(await screen.findByText(/invalid object name/i)).toBeInTheDocument();
  });

  it("offers an estimated execution plan control", async () => {
    renderIt();
    await screen.findByTestId("sql-editor");
    expect(screen.getByRole("button", { name: /plan/i })).toBeInTheDocument();
  });

  it("renders one result panel per GO batch and lets you switch between them", async () => {
    restore();
    restore = mockFetch({
      "/query": {
        batches: [
          {
            sql: "select 1",
            resultSets: [{ fields: ["a"], rows: [[1]], rowCount: 1, truncated: false }],
            rowsAffected: [],
            messages: [],
            durationMs: 3,
          },
          {
            sql: "select 2",
            resultSets: [{ fields: ["b"], rows: [[2]], rowCount: 1, truncated: false }],
            rowsAffected: [],
            messages: [],
            durationMs: 4,
          },
        ],
        totalDurationMs: 7,
      },
      "schemas/dbo/columns": { tables: [] },
    });
    renderIt();
    await run("select 1\nGO\nselect 2\nGO");
    expect(await screen.findByText("a")).toBeInTheDocument();
    expect(screen.queryByText("b")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /#2/ }));
    await waitFor(() => expect(screen.getByText("b")).toBeInTheDocument());
    expect(screen.queryByText("a")).toBeNull();
  });
});
