import type { z } from "zod";

export interface PreparedTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  run: (args: Record<string, unknown>, toolCallId: string) => Promise<unknown>;
}
