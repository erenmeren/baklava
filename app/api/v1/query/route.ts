import { ok, secured } from "../../../../lib/api";
import { BaklavaException, makeError } from "../../../../lib/errors";
import { loadConnections } from "../../../../lib/config";
import { getPlugin } from "../../../../lib/plugins";
import { runQuery, type RegisteredSource } from "../../../../lib/pipeline";

interface QueryBody {
  nl?: unknown;
  perSourceLimit?: unknown;
}

export const POST = secured(async (req) => {
  const body = (await req.json().catch(() => ({}))) as QueryBody;
  if (typeof body.nl !== "string" || body.nl.trim().length === 0) {
    throw new BaklavaException(
      makeError({
        code: "E_INTERNAL",
        what: "Request body must include { nl: string }.",
        why: "The query endpoint takes a natural-language question to plan against.",
        fix: 'POST a JSON body like {"nl":"show me users with paid orders"}.',
      })
    );
  }
  const perSourceLimit =
    typeof body.perSourceLimit === "number" ? body.perSourceLimit : undefined;

  const file = loadConnections();
  if (file.connections.length === 0) {
    throw new BaklavaException(
      makeError({
        code: "E_CONNECTION_NOT_FOUND",
        what: "No connections are configured.",
        why: "The pipeline can't plan a query when there are no sources.",
        fix: "Add a connection in Settings, or run `npx baklava --demo` for a zero-setup tour.",
      })
    );
  }

  // Connect every configured source. If any one fails, disconnect the others
  // and surface the failure — partial-execution is forbidden.
  const sources: RegisteredSource[] = [];
  try {
    for (const cfg of file.connections) {
      const plugin = getPlugin(cfg.plugin);
      plugin.validateConfig(cfg);
      const handle = await plugin.connect(cfg);
      const schemas = await plugin.listTables(handle);
      sources.push({
        connectionName: cfg.name,
        pluginName: cfg.plugin,
        plugin,
        handle,
        schemas,
      });
    }

    const result = await runQuery({
      nl: body.nl,
      sources,
      ...(perSourceLimit !== undefined ? { perSourceLimit } : {}),
    });
    return ok(result);
  } finally {
    for (const src of sources) {
      try {
        await src.plugin.disconnect(src.handle);
      } catch {
        // Don't mask the original error with a disconnect failure.
      }
    }
  }
});
