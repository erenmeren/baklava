import { render, screen } from "@testing-library/react";
import Home from "@/app/page";

describe("Home", () => {
  it("Should Have Baklava Text", () => {
    // Arrange
    render(<Home />);

    // Act
    const LearnText: HTMLElement = screen.getByText("Baklava");

    // Assert
    expect(LearnText).toBeInTheDocument();
  });
});
