import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContainerPicker } from "./container-picker";

describe("ContainerPicker", () => {
  it("renders nothing for a single-container pod", () => {
    const { container } = render(
      <ContainerPicker containers={["api"]} value={null} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the pod reports no containers at all", () => {
    const { container } = render(
      <ContainerPicker containers={[]} value={null} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers every container once there is a choice", () => {
    render(
      <ContainerPicker containers={["api", "sidecar"]} value={null} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "api" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "sidecar" })).toBeTruthy();
  });

  it("marks the first container selected when nothing was chosen yet", () => {
    render(
      <ContainerPicker containers={["api", "sidecar"]} value={null} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "api" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "sidecar" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reports the pick", () => {
    const onChange = vi.fn();
    render(
      <ContainerPicker containers={["api", "sidecar"]} value="api" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "sidecar" }));
    expect(onChange).toHaveBeenCalledWith("sidecar");
  });
});
