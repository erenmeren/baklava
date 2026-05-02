import { ok, secured } from "../../../../lib/api.js";
import { BaklavaException, makeError } from "../../../../lib/errors.js";
import {
  loadConnections,
  saveConnections,
  CURRENT_SCHEMA_VERSION,
  type ConnectionConfig,
} from "../../../../lib/config.js";
import { getPlugin } from "../../../../lib/plugins.js";

export const GET = secured(async () => {
  const file = loadConnections();
  return ok(
    file.connections.map((c) => ({
      name: c.name,
      plugin: c.plugin,
      // Don't return secrets back to the browser. Mask them.
      config: maskSecrets(c.config),
    }))
  );
});

interface AddBody {
  name?: unknown;
  plugin?: unknown;
  config?: unknown;
}

export const POST = secured(async (req) => {
  const body = (await req.json().catch(() => ({}))) as AddBody;
  if (typeof body.name !== "string" || !body.name.trim())
    throw bad("name must be a non-empty string");
  if (typeof body.plugin !== "string" || !body.plugin.trim())
    throw bad("plugin must be a non-empty string");
  if (!body.config || typeof body.config !== "object")
    throw bad("config must be an object");

  const cfg: ConnectionConfig = {
    name: body.name.trim(),
    plugin: body.plugin.trim(),
    config: body.config as Record<string, unknown>,
  };

  // Validate via the plugin before persisting.
  const plugin = getPlugin(cfg.plugin);
  plugin.validateConfig(cfg);

  const file = loadConnections();
  if (file.connections.some((c) => c.name === cfg.name)) {
    throw new BaklavaException(
      makeError({
        code: "E_CONNECTION_DUPLICATE_NAME",
        what: `A connection named "${cfg.name}" already exists.`,
        why: "Connection names are unique identifiers for the SQL alias system.",
        fix: "Pick a different name, or delete the existing connection first.",
      })
    );
  }
  file.connections.push(cfg);
  file.schema_version = CURRENT_SCHEMA_VERSION;
  saveConnections(file);
  return ok({ name: cfg.name, plugin: cfg.plugin, config: maskSecrets(cfg.config) });
});

interface DeleteBody {
  name?: unknown;
}

export const DELETE = secured(async (req) => {
  const body = (await req.json().catch(() => ({}))) as DeleteBody;
  if (typeof body.name !== "string" || !body.name.trim())
    throw bad("name must be a non-empty string");

  const file = loadConnections();
  const before = file.connections.length;
  file.connections = file.connections.filter((c) => c.name !== body.name);
  if (file.connections.length === before) {
    throw new BaklavaException(
      makeError({
        code: "E_CONNECTION_NOT_FOUND",
        what: `No connection named "${body.name}".`,
        why: "It may already be deleted, or the name was mistyped.",
        fix: "Refresh the page; the connections list will reflect the current state.",
      })
    );
  }
  saveConnections(file);
  return ok({ deleted: body.name });
});

function bad(why: string): BaklavaException {
  return new BaklavaException(
    makeError({
      code: "E_INTERNAL",
      what: "Invalid request body.",
      why,
      fix: "See the API contract for the required body shape.",
    })
  );
}

const SECRET_KEYS = new Set(["password", "secret", "token", "apikey", "api_key"]);
function maskSecrets(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (SECRET_KEYS.has(k.toLowerCase()) && typeof v === "string" && v.length > 0) {
      out[k] = "********";
    } else {
      out[k] = v;
    }
  }
  return out;
}
