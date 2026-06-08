/**
 * Dogfood: drives the actual AI `docker_*` tools against the real local Docker
 * daemon. Read-only ops only (never stops/removes real containers). Gated by
 * BAKLAVA_INTEGRATION=1; self-skips if the daemon socket isn't reachable.
 *
 *   BAKLAVA_INTEGRATION=1 npx vitest run src/lib/ai/tools/docker.integration.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dockerTools } from "./docker";
import type { AiTool } from "./types";

const cfg = {
  mode: "socket" as const,
  socketPath: process.env.BAKLAVA_DOCKER_SOCKET ?? "/var/run/docker.sock",
};
const tools = dockerTools("dogfood-conn", cfg as never);
const tool = (name: string): AiTool => tools.find((t) => t.name === name)!;

// Probe the daemon by actually listing containers — works for the unix socket
// (the TCP reachability helper can't).
async function daemonUp(): Promise<{ up: boolean; first?: string }> {
  try {
    const list = (await tool("docker_list_containers").execute({ all: true })) as { id?: string; names?: string[] }[];
    return { up: true, first: list[0]?.id ?? (list[0]?.names ?? [])[0] };
  } catch {
    return { up: false };
  }
}

describe("docker tools against the real daemon", async () => {
  const { up, first } = await daemonUp();
  beforeAll(() => {
    if (!up) console.warn("[skip] docker daemon not reachable");
  });

  it.skipIf(!up)("lists containers (read) including a known running service", async () => {
    const list = await tool("docker_list_containers").execute({ all: true });
    const blob = JSON.stringify(list);
    // One of the dogfood services should be present.
    expect(/mongo|redis|minio|postgres/i.test(blob)).toBe(true);
  });

  it.skipIf(!up || !first)("inspects and reads logs for a real container", async () => {
    const inspected = await tool("docker_inspect").execute({ containerId: first! });
    expect(JSON.stringify(inspected).length).toBeGreaterThan(2);

    const logs = await tool("docker_read_logs").execute({ containerId: first!, tail: 5 });
    expect(typeof JSON.stringify(logs)).toBe("string");
  }, 20000);

  it("tags mutating docker tools as write/destructive (categorization)", () => {
    const cat = Object.fromEntries(tools.map((t) => [t.name, t.category]));
    expect(cat["docker_list_containers"]).toBe("read");
    expect(cat["docker_action"]).toBe("write");
    expect(cat["docker_remove"]).toBe("destructive");
  });
});
