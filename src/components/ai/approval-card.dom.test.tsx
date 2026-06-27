import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalCard, type PendingApproval } from "./approval-card";

function high(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    toolCallId: "t1",
    tool: "pg_drop_table",
    category: "destructive",
    args: { table: "orders" },
    connection: { id: "c1", name: "prod-db" },
    risk: { level: "high", reasons: ["Destructive operation (pg_drop_table)"] },
    ...overrides,
  };
}

describe("ApprovalCard", () => {
  it("low/medium approve immediately", () => {
    const onDecision = vi.fn();
    render(
      <ApprovalCard
        pending={{ toolCallId: "t2", tool: "redis_set_string", category: "write", args: {}, risk: { level: "medium", reasons: [] } }}
        onDecision={onDecision}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onDecision).toHaveBeenCalledWith("t2", "approve");
  });

  it("high-risk Approve is disabled until the connection name is typed", () => {
    const onDecision = vi.fn();
    render(<ApprovalCard pending={high()} onDecision={onDecision} />);
    const approve = screen.getByRole("button", { name: /approve/i });
    expect(approve).toBeDisabled();
    fireEvent.click(approve);
    expect(onDecision).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "prod-db" } });
    expect(approve).not.toBeDisabled();
    fireEvent.click(approve);
    expect(onDecision).toHaveBeenCalledWith("t1", "approve");
  });

  it("high-risk shows the risk reasons", () => {
    render(<ApprovalCard pending={high()} onDecision={vi.fn()} />);
    expect(screen.getByText(/destructive operation/i)).toBeInTheDocument();
  });
});
