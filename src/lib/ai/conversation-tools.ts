import { z } from "zod";
import type { TechId } from "@/lib/connections/types";
import type { AiTool } from "./tools/types";
import { buildTools } from "./tools/registry";
import { wrapExecute, type GateContext } from "./gate";
import type { PermissionPolicy } from "./permissions";
import type { PreparedTool } from "./prepared";

export interface ConversationConnection {
  id: string;
  tech: TechId;
  name: string;
  config: unknown;
  policy: PermissionPolicy;
  /** Acting user's effective access to this connection. Fail-closed: "none". */
  access: "none" | "read" | "write";
}

export interface ConversationGateBase {
  sessionId: string;
  /** Acting user's id (fail-closed: empty string when no user). */
  userId: string;
  emit: (event: string, data: unknown) => void;
  awaitApproval: (
    toolCallId: string,
    tool: AiTool,
    args: unknown,
    connection: { id: string; name: string },
  ) => Promise<boolean>;
  now?: () => number;
}

function computeHandles(conns: ConversationConnection[]): Map<string, string> {
  const nameCount = new Map<string, number>();
  for (const c of conns) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const c of conns) {
    out.set(c.id, (nameCount.get(c.name) ?? 0) > 1 ? `${c.name}#${c.id.slice(0, 6)}` : c.name);
  }
  return out;
}

interface Entry {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handle: string;
  run: (args: Record<string, unknown>, toolCallId: string) => Promise<unknown>;
}

export function buildConversationTools(
  conns: ConversationConnection[],
  base: ConversationGateBase,
): PreparedTool[] {
  const handles = computeHandles(conns);
  const entries: Entry[] = [];

  for (const c of conns) {
    const handle = handles.get(c.id)!;
    const gate: GateContext = {
      policy: c.policy,
      connectionId: c.id,
      sessionId: base.sessionId,
      userId: base.userId,
      connectionAccess: c.access,
      emit: base.emit,
      now: base.now,
      awaitApproval: (toolCallId, tool, args) =>
        base.awaitApproval(toolCallId, tool, args, { id: c.id, name: c.name }),
    };
    const tools: AiTool[] = buildTools(c.tech, c.id, c.config, c.policy);
    for (const t of tools) {
      entries.push({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as z.ZodObject<z.ZodRawShape>,
        handle,
        run: wrapExecute(t, gate),
      });
    }
  }

  const byName = new Map<string, Entry[]>();
  for (const e of entries) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e);
    byName.set(e.name, arr);
  }

  const prepared: PreparedTool[] = [];
  for (const [name, group] of byName) {
    const groupHandles = group.map((e) => e.handle);
    const byHandle = new Map(group.map((e) => [e.handle, e.run]));
    const baseObject = group[0].inputSchema;
    const mergedSchema = baseObject.extend({
      connection: z.enum(groupHandles as [string, ...string[]]),
    });
    const mergedRun = async (args: Record<string, unknown>, toolCallId: string) => {
      const { connection, ...rest } = args as { connection?: string } & Record<string, unknown>;
      const run = connection ? byHandle.get(connection) : undefined;
      if (!run) {
        return { error: `Specify a valid connection. Options: ${groupHandles.join(", ")}` };
      }
      return run(rest, toolCallId);
    };
    prepared.push({
      name,
      description: `${group[0].description} Target connection: ${groupHandles.join(" | ")}.`,
      inputSchema: mergedSchema,
      run: mergedRun,
    });
  }

  return prepared;
}
