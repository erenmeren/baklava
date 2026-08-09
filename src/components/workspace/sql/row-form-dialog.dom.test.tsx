import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockFetch, httpError } from "@/test/fetch-mock";
import { Toaster } from "@/components/ui/sonner";
import { RowFormDialog, type RowFormDialect, type CellState } from "./row-form-dialog";
import type { SqlColumn } from "./types";

const COLUMNS: SqlColumn[] = [
  { name: "id", position: 1, dataType: "integer", nullable: false, default: "nextval(…)", isPrimaryKey: true },
  { name: "email", position: 2, dataType: "text", nullable: false, default: null, isPrimaryKey: false },
  { name: "bio", position: 3, dataType: "text", nullable: true, default: null, isPrimaryKey: false },
  { name: "active", position: 4, dataType: "boolean", nullable: false, default: null, isPrimaryKey: false },
];

// A minimal dialect standing in for the three real ones. Each real dialect is
// exercised end-to-end by its own workspace's characterization suite; what
// this file proves is that the shared dialog honours whatever it is handed.
const DIALECT: RowFormDialect = {
  tint: "brand",
  lockedOnInsert: (c) => c.default !== null,
  isLongText: (dt) => dt === "text",
  isBoolean: (dt) => dt === "boolean",
  toBody: ({ mode, values, columns, initialRow }) => ({
    mode,
    values,
    pk: columns
      .filter((c) => c.isPrimaryKey)
      .map((c) => ({ column: c.name, value: initialRow?.[c.name] ?? null })),
  }),
};

let restore: () => void;
beforeEach(() => {
  restore = mockFetch({ "/rows": { rowsAffected: 1 } });
});
afterEach(() => restore());

function lastBody(): Record<string, unknown> {
  const calls = (globalThis.fetch as unknown as {
    mock: { calls: [string, RequestInit?][] };
  }).mock.calls;
  return JSON.parse(String(calls[calls.length - 1][1]!.body));
}

function renderInsert(onSuccess = vi.fn()) {
  render(
    <>
      <Toaster />
      <RowFormDialog
        open
        onOpenChange={() => {}}
        mode="insert"
        base="/api/postgres/c1/databases/appdb/schemas/public/tables/users"
        title="Insert row"
        columns={COLUMNS}
        dialect={DIALECT}
        onSuccess={onSuccess}
      />
    </>,
  );
}

describe("RowFormDialog", () => {
  it("starts a column the dialect locks on insert in its default state", () => {
    renderInsert();
    // `id` has a server default, so it is not settable — its editor is off and
    // the cell reads `default`, not an empty value.
    const idRow = screen.getByText("id").closest("[data-row]")!;
    expect(idRow).toHaveTextContent("default");
    expect(idRow.querySelector("input,textarea")).toBeNull();
  });

  it("renders a textarea for long-text columns and an input for the rest", () => {
    renderInsert();
    expect(screen.getByLabelText("bio").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("active").tagName).not.toBe("TEXTAREA");
  });

  it("sends a typed value in the tagged-union shape the dialect asked for", async () => {
    const onSuccess = vi.fn();
    renderInsert(onSuccess);
    fireEvent.change(screen.getByLabelText("email"), {
      target: { value: "a@example.com" },
    });
    // The real dialogs' submit copy is "Insert row" / "Save changes", not the
    // bare "Insert" / "Save" the brief sketched — see row-form-dialog.tsx's
    // three predecessors. Matching the real copy here.
    fireEvent.click(screen.getByRole("button", { name: /^insert row$/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const body = lastBody() as { values: Record<string, CellState> };
    expect(body.values.email).toEqual({ kind: "value", value: "a@example.com" });
    expect(body.values.id).toEqual({ kind: "default" });
  });

  it("sends an explicit null when the null toggle is used", async () => {
    const onSuccess = vi.fn();
    renderInsert(onSuccess);
    fireEvent.click(screen.getByRole("button", { name: /set bio to null/i }));
    fireEvent.click(screen.getByRole("button", { name: /^insert row$/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect((lastBody() as { values: Record<string, CellState> }).values.bio).toEqual({
      kind: "null",
    });
  });

  it("PATCHes in edit mode and carries the original primary key", async () => {
    const onSuccess = vi.fn();
    render(
      <RowFormDialog
        open
        onOpenChange={() => {}}
        mode="edit"
        base="/api/postgres/c1/databases/appdb/schemas/public/tables/users"
        title="Edit row"
        columns={COLUMNS}
        initialRow={{ id: 7, email: "old@example.com", bio: null, active: true }}
        dialect={DIALECT}
        onSuccess={onSuccess}
      />,
    );
    expect(screen.getByLabelText("email")).toHaveValue("old@example.com");
    fireEvent.change(screen.getByLabelText("email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save changes$/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const calls = (globalThis.fetch as unknown as {
      mock: { calls: [string, RequestInit?][] };
    }).mock.calls;
    expect(calls[calls.length - 1][1]!.method).toBe("PATCH");
    expect(lastBody().pk).toEqual([{ column: "id", value: 7 }]);
  });

  it("surfaces the server error and keeps the dialog open on failure", async () => {
    restore();
    restore = mockFetch({
      "/rows": httpError(502, 'duplicate key value violates unique constraint "users_email_key"'),
    });
    const onSuccess = vi.fn();
    renderInsert(onSuccess);
    fireEvent.change(screen.getByLabelText("email"), {
      target: { value: "a@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^insert row$/i }));
    expect(await screen.findByText(/duplicate key value/)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
