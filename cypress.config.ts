import { defineConfig } from "cypress"

export default defineConfig({
  component: {
    devServer: {
      framework: "next",
      bundler: "webpack",
    },
  },

  e2e: {
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
})

// import { defineConfig } from 'cypress'

// export default defineConfig({
//   e2e: {
//     setupNodeEvents(on, config) {},
//   },
//   component: {
//     devServer: {
//       framework: 'next',
//       bundler: 'webpack',
//     },
//   },
// })
