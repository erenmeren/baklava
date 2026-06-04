import type { z } from "zod";
import type { ToolCategory } from "../permissions";

export interface AiTool {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: z.ZodType;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}
