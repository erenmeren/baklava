import { z } from "zod";
import type { DockerConfig } from "@/lib/connections/types";
import {
  listContainers,
  inspectContainer,
  readContainerLogs,
  containerAction,
} from "@/lib/connections/docker";
import type { AiTool } from "./types";

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
      description: "Inspect a container's full configuration and state.",
      category: "read",
      inputSchema: z.object({ containerId: z.string() }),
      execute: async ({ containerId }) => inspectContainer(config, containerId as string),
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
      description: "Start, stop, restart, kill, pause, or unpause a container.",
      category: "write",
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
