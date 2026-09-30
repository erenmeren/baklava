import type { z } from "zod";
import type { ToolCategory } from "../permissions";

export interface AiTool {
  name: string;
  description: string;
  category: ToolCategory;
  /**
   * Some calls are more dangerous than the tool's usual self: a TTL of 0 is a
   * delete, `retention.ms=1` purges a topic, scaling to 0 stops a service. When
   * present, the gate uses the stricter of `category` and this — it can only
   * escalate, never relax.
   */
  categoryFor?: (args: Record<string, unknown>) => ToolCategory;
  inputSchema: z.ZodType;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}
