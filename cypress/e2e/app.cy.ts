/// <reference types="cypress" />


describe("Check pages", () => {
  it("should open the home page", () => {
    cy.visit("http://localhost:3000");
    cy.get('h1').contains('Databases'); 
  });

  it("should open the postgreSQL", () => {
    cy.visit("http://localhost:3000/postgresql");
    // cy.get('h1').contains('PostgreSQL'); 
  });

  it("should open the docker page", () => {
    cy.visit("http://localhost:3000/docker");
    // cy.get('.error').should('not.exist'); 
  });
});



