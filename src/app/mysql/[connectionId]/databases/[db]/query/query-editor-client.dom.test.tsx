import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockFetch } from "@/test/fetch-mock";

// QueryEditorClient reads `useRouter` / `usePathname` / `useSearchParams` from
// next/navigation (the `?prefill=` handling effect). There is no App Router
// mounted in these tests, so the real hooks throw ("invariant expected app
// router to be mounted"). Stub the module instead of adding a router-testing
// dependency — same pattern as the table-detail tests.
const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => "/mysql/c1/databases/appdb/query/q1",
  useSearchParams: () => new URLSearchParams(),
}));

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

// Shape matches the POST /api/mysql/[id]/databases/[db]/query route
// (route.ts:50-63) — `{ results: StatementResult[], errors: StatementError[] }`.
// Unlike Postgres, MySQL rows are objects keyed by column name (not arrays),
// and there is no top-level `error`/`totalDurationMs` — the component sums
// `durationMs` across `results` itself.
const OK = {
  results: [
    {
      statement: "select 1",
      columns: ["id", "email"],
      rows: [{ id: 1, email: "a@example.com" }],
      rowCount: 1,
      truncated: false,
      durationMs: 12,
      command: null,
      isCommand: false,
    },
  ],
  errors: [],
};

let restore: () => void;

beforeEach(() => {
  restore = mockFetch({ "/query": OK });
});

afterEach(() => restore());

function renderIt() {
  return render(<QueryEditorClient connectionId="c1" db="appdb" queryId="q1" />);
}

async function run(sql: string) {
  fireEvent.change(screen.getByTestId("sql-editor"), { target: { value: sql } });
  fireEvent.click(screen.getByRole("button", { name: /run|execute/i }));
}

describe("mysql QueryEditorClient (characterization)", () => {
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
    // "1 row" comes from <ResultActions> above the grid.
    expect(await screen.findByText(/1 row/i)).toBeInTheDocument();
    // "12ms" comes from the status line's second <strong>.
    expect(screen.getByText(/12\s*ms/i)).toBeInTheDocument();
  });

  it("renders the error text rather than an empty grid on failure", async () => {
    restore();
    // MySQL stops at the first failing statement — a query that fails before
    // producing any result set comes back with an empty `results` and the
    // failure in `errors[0]` (route.ts + execute()'s `resp.results.length
    // === 0` branch).
    restore = mockFetch({
      "/query": {
        results: [],
        errors: [
          { statement: "select * from nope", error: "Table 'appdb.nope' doesn't exist" },
        ],
      },
    });
    renderIt();
    await run("select * from nope");
    expect((await screen.findAllByText(/doesn't exist/i)).length).toBeGreaterThan(0);
  });

  it("offers an EXPLAIN control", async () => {
    renderIt();
    await screen.findByTestId("sql-editor");
    expect(screen.getByRole("button", { name: /explain/i })).toBeInTheDocument();
  });

  it("renders one result panel per statement and lets you switch between them", async () => {
    // MySQL also runs statement lists, and — like Postgres — shows exactly
    // one statement's result at a time; clicking a numbered tab repoints the
    // Data/Messages panes at that statement rather than rendering every
    // statement's grid simultaneously.
    restore();
    restore = mockFetch({
      "/query": {
        results: [
          {
            statement: "select 1",
            columns: ["a"],
            rows: [{ a: 1 }],
            rowCount: 1,
            truncated: false,
            durationMs: 3,
            command: null,
            isCommand: false,
          },
          {
            statement: "select 2",
            columns: ["b"],
            rows: [{ b: 2 }],
            rowCount: 1,
            truncated: false,
            durationMs: 4,
            command: null,
            isCommand: false,
          },
        ],
        errors: [],
      },
    });
    renderIt();
    await run("select 1; select 2;");
    expect(await screen.findByText("a")).toBeInTheDocument();
    expect(screen.queryByText("b")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /#2/ }));
    await waitFor(() => expect(screen.getByText("b")).toBeInTheDocument());
    expect(screen.queryByText("a")).toBeNull();
  });
});
