/**
 * Minimal Confluent-compatible Schema Registry client.
 *
 * Confluent's wire format is documented here:
 *   magic byte (0x00) + 4-byte big-endian schema id + binary payload
 *
 * We support three schema types Confluent surfaces in the SR HTTP API:
 *   - AVRO         (decoded via the `avsc` package)
 *   - JSON         (validated, then returned as-is parsed JSON)
 *   - PROTOBUF     (we surface schema metadata only; full decoding requires
 *                   the schema's compiled descriptor, deferred for now)
 *
 * Schemas are cached on a per-connection `SchemaRegistryClient` instance —
 * recreate the client if the connection record is updated.
 */

import type { Type as AvroType } from "avsc"; // type-only — erased at build, safe when avsc absent
import { DriverNotInstalledError } from "@/techs/contract";

let _avscMod: typeof import("avsc") | null = null;
async function getAvsc(): Promise<typeof import("avsc")> {
  try {
    return (_avscMod ??= await import("avsc"));
  } catch {
    throw new DriverNotInstalledError("kafka", "avsc");
  }
}

export type SchemaType = "AVRO" | "JSON" | "PROTOBUF";

export interface RegisteredSchema {
  id: number;
  type: SchemaType;
  schema: string;
  subject?: string;
  version?: number;
}

export interface SchemaRegistryConfig {
  url: string;
  auth?: { username: string; password: string };
}

export class SchemaRegistryError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SchemaRegistryError";
  }
}

export interface DecodedPayload {
  /** Schema id Confluent prepended to the wire bytes. */
  schemaId: number;
  /** Schema type as reported by the registry. */
  schemaType: SchemaType;
  /** Subject for the schema, if SR could resolve one (best-effort). */
  subject: string | null;
  /** Schema version (best-effort). */
  version: number | null;
  /**
   * The decoded value, ready to be JSON.stringified for the wire. For Avro
   * we use the canonical JSON projection; for JSON we return the parsed
   * object; for Protobuf we currently return null and rely on `note`.
   */
  decoded: unknown;
  /**
   * Diagnostic — populated when we know we couldn't fully decode (e.g.
   * PROTOBUF without descriptor).
   */
  note?: string;
}

const CONFLUENT_MAGIC_BYTE = 0x00;

/**
 * Sniff the Confluent magic-byte framing. Returns `{ schemaId, payload }`
 * when the buffer begins with `0x00 + 4 BE bytes`, else null.
 */
export function sniffMagicByte(
  buf: Buffer,
): { schemaId: number; payload: Buffer } | null {
  if (buf.length < 5) return null;
  if (buf[0] !== CONFLUENT_MAGIC_BYTE) return null;
  const schemaId = buf.readUInt32BE(1);
  return { schemaId, payload: buf.subarray(5) };
}

export class SchemaRegistryClient {
  private readonly url: string;
  private readonly auth?: SchemaRegistryConfig["auth"];
  private readonly byId = new Map<number, RegisteredSchema>();
  private readonly avroTypes = new Map<number, AvroType>();
  /** In-flight fetches keyed by id so concurrent consumers don't duplicate. */
  private readonly inflight = new Map<number, Promise<RegisteredSchema>>();

  constructor(config: SchemaRegistryConfig) {
    // Trim trailing slash so we can always concat with `/…`.
    this.url = config.url.replace(/\/+$/, "");
    this.auth = config.auth;
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = {
      accept: "application/vnd.schemaregistry.v1+json",
    };
    if (this.auth) {
      const tok = Buffer.from(
        `${this.auth.username}:${this.auth.password}`,
      ).toString("base64");
      h["authorization"] = `Basic ${tok}`;
    }
    return h;
  }

  /**
   * Fetch a schema by id, caching the result. Multiple concurrent callers
   * share one in-flight request.
   */
  async getSchema(id: number): Promise<RegisteredSchema> {
    const cached = this.byId.get(id);
    if (cached) return cached;
    const pending = this.inflight.get(id);
    if (pending) return pending;

    const p = (async () => {
      const r = await fetch(`${this.url}/schemas/ids/${id}`, {
        headers: this.headers(),
      });
      if (!r.ok) {
        throw new SchemaRegistryError(
          `Schema id ${id} not found (HTTP ${r.status})`,
          r.status,
        );
      }
      const body = (await r.json()) as {
        schema: string;
        schemaType?: SchemaType;
        subject?: string;
        version?: number;
      };
      const out: RegisteredSchema = {
        id,
        schema: body.schema,
        type: body.schemaType ?? "AVRO",
        subject: body.subject,
        version: body.version,
      };
      this.byId.set(id, out);
      return out;
    })().finally(() => {
      this.inflight.delete(id);
    });
    this.inflight.set(id, p);
    return p;
  }

  /** Get the latest subjects on the registry — used by the connection form. */
  async listSubjects(): Promise<string[]> {
    const r = await fetch(`${this.url}/subjects`, { headers: this.headers() });
    if (!r.ok) {
      throw new SchemaRegistryError(
        `listSubjects failed (HTTP ${r.status})`,
        r.status,
      );
    }
    return (await r.json()) as string[];
  }

  /** Probe — exchange a single GET so the form can verify the URL works. */
  async ping(): Promise<{ subjects: number }> {
    const subs = await this.listSubjects();
    return { subjects: subs.length };
  }

  /** Decode a payload that began with the Confluent magic byte. */
  async decode(buf: Buffer): Promise<DecodedPayload | null> {
    const sniff = sniffMagicByte(buf);
    if (!sniff) return null;
    const schema = await this.getSchema(sniff.schemaId);

    if (schema.type === "AVRO") {
      const { parse: parseAvro } = await getAvsc();
      try {
        let t: AvroType | undefined = this.avroTypes.get(sniff.schemaId);
        if (!t) {
          t = parseAvro(schema.schema) as AvroType;
          this.avroTypes.set(sniff.schemaId, t);
        }
        const decoded = t!.fromBuffer(sniff.payload);
        return {
          schemaId: sniff.schemaId,
          schemaType: "AVRO",
          subject: schema.subject ?? null,
          version: schema.version ?? null,
          decoded,
        };
      } catch (err) {
        return {
          schemaId: sniff.schemaId,
          schemaType: "AVRO",
          subject: schema.subject ?? null,
          version: schema.version ?? null,
          decoded: null,
          note: `Avro decode failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    if (schema.type === "JSON") {
      try {
        // The payload after the 5-byte header is plain UTF-8 JSON.
        const parsed = JSON.parse(sniff.payload.toString("utf8"));
        return {
          schemaId: sniff.schemaId,
          schemaType: "JSON",
          subject: schema.subject ?? null,
          version: schema.version ?? null,
          decoded: parsed,
        };
      } catch (err) {
        return {
          schemaId: sniff.schemaId,
          schemaType: "JSON",
          subject: schema.subject ?? null,
          version: schema.version ?? null,
          decoded: null,
          note: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // Protobuf: full decoding requires the compiled descriptor. We surface
    // the schema metadata so the UI can show the .proto and we don't claim
    // a decode we can't deliver.
    return {
      schemaId: sniff.schemaId,
      schemaType: "PROTOBUF",
      subject: schema.subject ?? null,
      version: schema.version ?? null,
      decoded: null,
      note: "Protobuf payload — schema fetched, but full decoding requires a descriptor not yet wired up.",
    };
  }
}

// ── per-connection client cache (lives on globalThis so HMR doesn't rebuild) ──

interface Bag {
  clients: Map<string, SchemaRegistryClient>;
}
const GLOBAL_KEY = Symbol.for("baklava.kafka.schemaRegistry");
function bag(): Bag {
  const g = globalThis as unknown as Record<symbol, Bag>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { clients: new Map() };
  return g[GLOBAL_KEY];
}

/**
 * Get-or-create a Schema Registry client for the given connection record.
 * Returns null when the connection has no SR URL configured.
 */
export function schemaRegistryFor(
  connectionId: string,
  config: SchemaRegistryConfig | null | undefined,
): SchemaRegistryClient | null {
  if (!config?.url) {
    bag().clients.delete(connectionId);
    return null;
  }
  // Re-create the client if the URL changed (covers edits to the connection).
  const existing = bag().clients.get(connectionId);
  if (existing && (existing as unknown as { __url: string }).__url === config.url) {
    return existing;
  }
  const client = new SchemaRegistryClient(config);
  (client as unknown as { __url: string }).__url = config.url;
  bag().clients.set(connectionId, client);
  return client;
}

export function dropSchemaRegistry(connectionId: string): void {
  bag().clients.delete(connectionId);
}
