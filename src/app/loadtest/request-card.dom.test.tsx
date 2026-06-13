import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RequestCard } from "./request-card";
import type { HttpMethod, RequestForm } from "./form-serialize";

function renderCard(method: HttpMethod) {
  const req: RequestForm = {
    name: "r1", method, path: "/x", headers: [], body: "",
    checkStatus: "", checkBodyContains: "", thinkTime: "",
  };
  return render(
    <RequestCard
      req={req}
      index={0}
      expanded
      onToggle={() => {}}
      onChange={() => {}}
      onRemove={() => {}}
      onMove={() => {}}
      canRemove
    />,
  );
}

describe("RequestCard", () => {
  it("shows the method and path without expanding logic hiding them", () => {
    renderCard("POST");
    expect(screen.getByDisplayValue("/x")).toBeInTheDocument();
  });

  // base-ui TabsTrigger uses focusableWhenDisabled:true, so it renders
  // aria-disabled="true" instead of the native disabled attribute.
  // Jest-dom's toBeDisabled() only checks native disabled — use toHaveAttribute instead.
  it("disables the Body tab for GET", () => {
    renderCard("GET");
    expect(screen.getByRole("tab", { name: /body/i })).toHaveAttribute("aria-disabled", "true");
  });

  it("enables the Body tab for POST", () => {
    renderCard("POST");
    expect(screen.getByRole("tab", { name: /body/i })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("disables the Body tab for HEAD", () => {
    renderCard("HEAD");
    expect(screen.getByRole("tab", { name: /body/i })).toHaveAttribute("aria-disabled", "true");
  });
});
