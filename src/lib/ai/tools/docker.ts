import { z } from "zod";
import type { DockerConfig } from "@/lib/connections/types";
import {
  listContainers,
  inspectContainer,
  readContainerLogs,
  containerAction,
} from "@/lib/connections/docker";
import type { AiTool } from "./types";

/**
 * `Config.Env` is where containers keep their database passwords and API keys.
 * Tool output goes to the LLM provider, so keep the variable names (useful for
 * debugging) and drop the values.
 */
export function redactContainerEnv(inspect: unknown): unknown {
  const env = (inspect as { Config?: { Env?: unknown } } | null)?.Config?.Env;
  if (!Array.isArray(env)) return inspect;
  const i = inspect as { Config: Record<string, unknown> };
  return {
    ...i,
    Config: {
      ...i.Config,
      Env: env.map((e) => {
        const s = String(e);
        const eq = s.indexOf("=");
        return eq < 0 ? s : `${s.slice(0, eq)}=<redacted>`;
      }),
    },
  };
}

export function dockerTools(_connectionId: string, config: DockerConfig): AiTool[] {
  return [
    {
      name: "docker_list_containers",
      description: "List containers (running and stopped).",
      category: "read",
      inputSchema: z.object({ all: z.boolean().default(true) }),
      execute: async ({ all }) => listContainers(config, (all as boolean) ?? true),
    },
    {
      name: "docker_inspect",
      description:
        "Inspect a container's full configuration and state. Environment variable values are redacted (names are kept).",
      category: "read",
      inputSchema: z.object({ containerId: z.string() }),
      execute: async ({ containerId }) =>
        redactContainerEnv(await inspectContainer(config, containerId as string)),
    },
    {
      name: "docker_read_logs",
      description: "Read the last N lines of a container's logs (stdout+stderr).",
      category: "read",
      inputSchema: z.object({
        containerId: z.string(),
        tail: z.number().int().min(1).max(2000).default(400),
      }),
      execute: async ({ containerId, tail }) =>
        readContainerLogs(config, containerId as string, { tail: (tail as number) ?? 400 }),
    },
    {
      name: "docker_action",
      description: "Start, stop, restart, kill, pause, or unpause a container. kill is DESTRUCTIVE (SIGKILL, no graceful shutdown).",
      category: "write",
      categoryFor: ({ action }) => (action === "kill" ? "destructive" : "write"),
      inputSchema: z.object({
        containerId: z.string(),
        action: z.enum(["start", "stop", "restart", "kill", "pause", "unpause"]),
      }),
      execute: async ({ containerId, action }) => {
        await containerAction(config, containerId as string, action as "start");
        return { ok: true, containerId, action };
      },
    },
    {
      name: "docker_remove",
      description: "Remove (delete) a container. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: z.object({ containerId: z.string() }),
      execute: async ({ containerId }) => {
        await containerAction(config, containerId as string, "remove");
        return { ok: true, removed: containerId };
      },
    },
  ];
}
