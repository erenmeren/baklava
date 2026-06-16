import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Three test projects with different environments:
//   - server      : node env, src/lib/** and API route handlers
//   - client      : happy-dom env, React component tests (.tsx + .dom.test.tsx)
//   - integration : node env, only when BAKLAVA_INTEGRATION=1 is set
//                   (these tests hit the real docker-compose services)
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Next.js ships `server-only` as a build-time guard that throws if
      // a server-only module is bundled into a client component. In
      // tests we run Node directly, so resolve it to a no-op stub.
      "server-only": new URL("./src/test/server-only-stub.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",
      // Coverage measures files that the unit-test suite is responsible
      // for. Driver implementations live in src/lib/connections/<tech>.ts
      // and are exercised by integration tests (BAKLAVA_INTEGRATION=1) +
      // E2E. Client React components are exercised by Playwright. Both
      // are excluded here so the % is meaningful.
      include: [
        "src/lib/connections/store.ts",
        "src/lib/connections/summaries.ts",
        "src/lib/connections/types.ts",
        "src/lib/errors.ts",
        "src/app/api/connections/**/*.ts",
        "src/app/api/**/test/route.ts",
      ],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/test/**",
      ],
      thresholds: {
        // Scoped to files the unit suite is responsible for (see `include`).
        // The driver implementations and React UI are tested through the
        // integration + E2E suites, not by unit tests, so they're excluded
        // from this %. The floor below reflects what the current suite
        // actually delivers — going down trips CI; going up is the goal.
        lines: 55,
        functions: 65,
        branches: 35,
        statements: 55,
        // Strict per-file floors on the security-critical surfaces.
        "src/lib/connections/store.ts": {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        "src/lib/errors.ts": {
          lines: 100,
          functions: 100,
          branches: 90,
          statements: 100,
        },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: [
            "src/test/**/*.test.ts",
            "src/lib/**/*.test.ts",
            "src/app/**/*.test.ts",
            "src/techs/**/*.test.ts",
          ],
          exclude: ["**/*.dom.test.*", "**/*.integration.test.*"],
        },
      },
      {
        extends: true,
        test: {
          name: "client",
          environment: "happy-dom",
          include: [
            "src/**/*.test.tsx",
            "src/**/*.dom.test.tsx",
          ],
          exclude: ["**/*.integration.test.*"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include:
            process.env.BAKLAVA_INTEGRATION === "1"
              ? ["src/**/*.integration.test.ts"]
              : [],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
