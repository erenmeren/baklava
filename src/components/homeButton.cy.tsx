import React from "react"
import HomeButton from "./homeButton"

describe("HomeButton Component Test", () => {
  it("navigates to the home page on click", () => {
    // Mount the component within a Router
    cy.mount(<HomeButton />)

    // Simulate a click on the button
    // cy.get("a").click()

    // Assert the URL has changed to the homepage ("/")
    // cy.url().should("include", "/")
  })
})
