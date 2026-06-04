import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { AiTool } from "./types";

describe("AiTool shape", () => {
  it("carries a category and a zod inputSchema", () => {
    const t: AiTool = {
      name: "demo",
      description: "demo tool",
      category: "read",
      inputSchema: z.object({ x: z.number() }),
      execute: async ({ x }) => ({ doubled: (x as number) * 2 }),
    };
    expect(t.category).toBe("read");
    expect(t.inputSchema.safeParse({ x: 2 }).success).toBe(true);
    expect(t.inputSchema.safeParse({ x: "no" }).success).toBe(false);
  });
});
