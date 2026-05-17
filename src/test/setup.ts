// Vitest global setup — runs once per worker before any test file.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Always isolate React render trees between tests.
afterEach(() => {
  cleanup();
});

// Force every test to use a deterministic, throwaway data dir so the real
// ~/.baklava/connections.json on the developer's machine is never touched.
// Each test file should still override this with its own tmpdir if it
// actually exercises persistence, but this is the belt-and-braces guard.
if (!process.env.BAKLAVA_DATA_DIR) {
  process.env.BAKLAVA_DATA_DIR = "/tmp/__baklava_test_safety__";
}
