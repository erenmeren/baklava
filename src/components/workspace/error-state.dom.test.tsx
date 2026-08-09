import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "./error-state";

describe("ErrorState", () => {
  it("renders as an alert carrying the destructive class the e2e spec matches on", () => {
    const { container } = render(
      <ErrorState title="Could not load data" message="connection refused" />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    // e2e/sql-workspaces.spec.ts matches '[role="alert"].text-destructive'.
    expect(container.querySelector('[role="alert"].text-destructive')).not.toBeNull();
  });

  it("shows both the title and the underlying driver message", () => {
    render(<ErrorState title="Could not load data" message="ECONNREFUSED 127.0.0.1:5432" />);
    expect(screen.getByText("Could not load data")).toBeInTheDocument();
    expect(screen.getByText("ECONNREFUSED 127.0.0.1:5432")).toBeInTheDocument();
  });

  it("renders no Retry button when no handler is given", () => {
    render(<ErrorState title="Could not load data" message="boom" />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("calls onRetry when Retry is clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Could not load data" message="boom" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
