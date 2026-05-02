import { ok, secured } from "../../../../lib/api.js";
import { loadConnections, getAnthropicApiKey } from "../../../../lib/config.js";

export const GET = secured(async () => {
  const connections = loadConnections();
  return ok({
    ok: true,
    hasAiKey: getAnthropicApiKey() !== null,
    connections: connections.connections.map((c) => ({
      name: c.name,
      plugin: c.plugin,
    })),
  });
});
