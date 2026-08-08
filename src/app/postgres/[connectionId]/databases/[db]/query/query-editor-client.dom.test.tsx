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
  usePathname: () => "/postgres/c1/databases/appdb/query/q1",
  useSearchParams: () => new URLSearchParams(),
}));

// CodeMirror needs layout APIs happy-dom doesn't provide. Mock it with a
// controlled <textarea> — this protects the surrounding workspace, not
// CodeMirror itself. Use forwardRef so passing `ref={cmRef}` (the component
// reads `cmRef.current?.view` for selection-based "run just the highlighted
// text") doesn't print React's "function components cannot be given refs"
// console.error.
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

// Shape matches the POST /api/postgres/[id]/databases/[db]/query route's
// multi-statement response (route.ts:48-64), which is what the component
// always sends (`multi: true` on every request — see execute()). Each entry
// is a StatementResult keyed by `fields` (not `columns`) with rows as
// arrays-of-cells (not row objects) — the brief's draft guessed `columns` /
// object rows, which is the MySQL shape, not Postgres's.
const OK = {
  results: [
    {
      sql: "select 1",
      fields: ["id", "email"],
      rows: [[1, "a@example.com"]],
      rowCount: 1,
      truncated: false,
      durationMs: 12,
      isCommand: false,
      command: null,
    },
  ],
  totalDurationMs: 12,
};

let restore: () => void;

// `window.localStorage` is undefined in this vitest+happy-dom setup (no
// polyfill is configured). The component's own load/save helpers wrap every
// localStorage access in try/catch and fall back to defaults on failure, so
// this is silently a no-op here rather than a crash — nothing to clear.
beforeEach(() => {
  restore = mockFetch({
    "/query": OK,
    // useSchemaCompletions fires this on mount to feed autocomplete; its
    // failure path is swallowed internally (sets completions to null), but
    // mock it anyway so a passing run doesn't depend on an internally
    // caught rejection.
    "schemas/public/columns": { tables: [] },
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

describe("postgres QueryEditorClient (characterization)", () => {
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
    // "1 row" comes from <ResultActions> above the grid (rowCount.toLocaleString()
    // + " row" + pluralizer — all direct text children of the same <span>).
    expect(await screen.findByText(/1 row/i)).toBeInTheDocument();
    // "12ms" comes from the status line's second <strong> (durationMs + "ms").
    expect(screen.getByText(/12\s*ms/i)).toBeInTheDocument();
  });

  it("renders the error text rather than an empty grid on failure", async () => {
    restore();
    restore = mockFetch({
      "/query": {
        results: [
          {
            sql: "select * from nope",
            error: 'relation "nope" does not exist',
            durationMs: 5,
          },
        ],
        totalDurationMs: 5,
      },
      "schemas/public/columns": { tables: [] },
    });
    renderIt();
    await run("select * from nope");
    // The error text renders twice — the status-line summary and the
    // Messages tab's <pre> both show it — so assert with findAllByText.
    expect((await screen.findAllByText(/does not exist/i)).length).toBeGreaterThan(0);
  });

  it("offers an EXPLAIN control", async () => {
    renderIt();
    await screen.findByTestId("sql-editor");
    expect(screen.getByRole("button", { name: /explain/i })).toBeInTheDocument();
  });

  it("renders one result panel per statement and lets you switch between them", async () => {
    // Both the Postgres and MySQL editors show exactly one statement's
    // result at a time — clicking a numbered tab in the multi-result strip
    // repoints Data/Messages at that statement. They do not render every
    // statement's grid simultaneously (the brief's original draft assumed
    // they did); this test characterizes the actual switch behaviour.
    restore();
    restore = mockFetch({
      "/query": {
        results: [
          {
            sql: "select 1",
            fields: ["a"],
            rows: [[1]],
            rowCount: 1,
            truncated: false,
            durationMs: 3,
            isCommand: false,
            command: null,
          },
          {
            sql: "select 2",
            fields: ["b"],
            rows: [[2]],
            rowCount: 1,
            truncated: false,
            durationMs: 4,
            isCommand: false,
            command: null,
          },
        ],
        totalDurationMs: 7,
      },
      "schemas/public/columns": { tables: [] },
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
