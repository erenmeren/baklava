import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// Smoke test: verifies happy-dom + @testing-library/react + jest-dom work.
describe("dom harness", () => {
  it("renders a React tree and matches via jest-dom", () => {
    render(<div data-testid="hello">honey</div>);
    const el = screen.getByTestId("hello");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("honey");
  });
});
