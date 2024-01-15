import React from "react"
import Loader from "./loader"

describe("Loader Component Test", () => {
  it("renders the loader with the correct classes", () => {
    cy.mount(<Loader className="extra-class" />) // Use cy.mount to mount the component

    // Check if the Loader component is rendered
    cy.get("div")
      .should("have.class", "flex")
      .and("have.class", "text-sm")
      .and("have.class", "extra-class")

    // Check if the icon has the correct classes
    cy.get("div > svg")
      .should("have.class", "mr-1")
      .and("have.class", "h-5")
      .and("have.class", "w-5")
      .and("have.class", "animate-spin")

    // Check for the presence of the "Loading" text
    cy.contains("Loading").should("exist")
  })
})
