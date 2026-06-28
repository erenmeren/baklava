import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSecretFileSync } from "@/lib/crypto/secret-file";

// The store captures DATA_DIR at module load and caches its state on
// globalThis. We need to (1) set BAKLAVA_DATA_DIR before the first import,
// (2) reset the globalThis cache between tests, and (3) re-import the
// module fresh so DATA_DIR is recomputed against the new tmpdir.
async function freshStore(dataDir: string) {
  process.env.BAKLAVA_DATA_DIR = dataDir;
  const sym = Symbol.for("baklava.connectionStore");
  delete (globalThis as Record<symbol, unknown>)[sym];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.masterKeyMaterial")];
  vi.resetModules();
  return import("./store");
}

const KAFKA_SAMPLE = {
  clientId: "baklava",
  brokers: ["localhost:9092"],
  ssl: false,
  sasl: {
    mechanism: "plain" as const,
    username: "kafka",
    password: "kafka-secret-pw",
  },
};

const POSTGRES_SAMPLE = {
  host: "localhost",
  port: 5432,
  database: "postgres",
  user: "postgres",
  password: "pg-secret-pw",
  ssl: false,
};

describe("connection store", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-store-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe("saveConnection + persistence", () => {
    it("persists a saved connection to disk under the configured DATA_DIR", async () => {
      const store = await freshStore(dataDir);
      store.saveConnection({
        tech: "postgres",
        name: "Test PG",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      const file = join(dataDir, "connections.json");
      expect(existsSync(file)).toBe(true);
      const written = JSON.parse(readSecretFileSync(file)!);
      expect(written.version).toBe(1);
      expect(written.connections).toHaveLength(1);
      expect(written.connections[0].name).toBe("Test PG");
    });

    it("writes the connections file with mode 0600 (owner read/write only)", async () => {
      const store = await freshStore(dataDir);
      store.saveConnection({
        tech: "postgres",
        name: "secure",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      const file = join(dataDir, "connections.json");
      const mode = statSync(file).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("creates the data dir if it doesn't exist, with mode 0700", async () => {
      // Use a non-existent subdir so we exercise mkdir
      const nested = join(dataDir, "nested", "deep");
      const store = await freshStore(nested);
      store.saveConnection({
        tech: "sqlserver",
        name: "s",
        config: {
          host: "localhost",
          port: 1433,
          database: "master",
          user: "sa",
          password: "x",
          encrypt: false,
          trustServerCertificate: true,
        },
        status: "ok",
      });
      const dirMode = statSync(nested).mode & 0o777;
      expect(dirMode).toBe(0o700);
    });

    it("writes atomically via a *.tmp rename — no partial file ever observed", async () => {
      const store = await freshStore(dataDir);
      store.saveConnection({
        tech: "postgres",
        name: "atom",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      const file = join(dataDir, "connections.json");
      const tmpFile = `${file}.tmp`;
      // The atomic-rename protocol means the .tmp must NOT exist after a
      // successful flush.
      expect(existsSync(tmpFile)).toBe(false);
      expect(existsSync(file)).toBe(true);
    });

    it("assigns a non-empty unique id to every saved connection", async () => {
      const store = await freshStore(dataDir);
      const a = store.saveConnection({
        tech: "postgres",
        name: "a",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      const b = store.saveConnection({
        tech: "postgres",
        name: "b",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      expect(a.id).toBeTruthy();
      expect(b.id).toBeTruthy();
      expect(a.id).not.toBe(b.id);
    });

    it("only sets lastTestedAt when status is NOT 'untested'", async () => {
      const store = await freshStore(dataDir);
      const tested = store.saveConnection({
        tech: "postgres",
        name: "t",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      const untested = store.saveConnection({
        tech: "postgres",
        name: "u",
        config: POSTGRES_SAMPLE,
        status: "untested",
      });
      expect(tested.lastTestedAt).toBeTypeOf("number");
      expect(untested.lastTestedAt).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe("load on first access", () => {
    it("reads existing connections.json on first getStore() call", async () => {
      // Seed the file with a fresh store, then re-import to verify load.
      const first = await freshStore(dataDir);
      first.saveConnection({
        tech: "postgres",
        name: "seeded",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });

      // Simulate a process restart by clearing the globalThis cache and
      // re-importing the module.
      const second = await freshStore(dataDir);
      const all = second.listConnections();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("seeded");
    });

    it("returns an empty list and does NOT crash when the file is missing", async () => {
      const store = await freshStore(dataDir);
      expect(store.listConnections()).toEqual([]);
    });

    it("tolerates a malformed file and warns rather than crashing", async () => {
      // Write garbage to the file, then load.
      const file = join(dataDir, "connections.json");
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(file, "{not json", "utf8");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = await freshStore(dataDir);
      expect(store.listConnections()).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("accepts the legacy { connections: [...] } shape with no version", async () => {
      const file = join(dataDir, "connections.json");
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({
          connections: [
            {
              id: "legacy-1",
              tech: "postgres",
              name: "legacy",
              config: POSTGRES_SAMPLE,
              status: "ok",
              createdAt: 1,
            },
          ],
        }),
        "utf8",
      );
      const store = await freshStore(dataDir);
      const all = store.listConnections();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe("legacy-1");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe("updateStatus", () => {
    it("updates status in memory", async () => {
      const store = await freshStore(dataDir);
      const c = store.saveConnection({
        tech: "postgres",
        name: "s",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      const updated = store.updateStatus(c.id, "error", "boom");
      expect(updated?.status).toBe("error");
      expect(updated?.lastError).toBe("boom");
      expect(updated?.lastTestedAt).toBeTypeOf("number");
    });

    it("does NOT flush to disk (would thrash on every probe)", async () => {
      const store = await freshStore(dataDir);
      const c = store.saveConnection({
        tech: "postgres",
        name: "s",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      // Snapshot file mtime, then updateStatus, then re-stat. mtime should
      // not move because the flush was suppressed.
      const file = join(dataDir, "connections.json");
      const beforeMtime = statSync(file).mtimeMs;
      // Force at least 5ms gap so mtime would be different if a write happened.
      await new Promise((r) => setTimeout(r, 10));
      store.updateStatus(c.id, "error", "x");
      const afterMtime = statSync(file).mtimeMs;
      expect(afterMtime).toBe(beforeMtime);
    });

    it("returns undefined for an unknown id", async () => {
      const store = await freshStore(dataDir);
      expect(store.updateStatus("nope", "ok")).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe("updateConnection — secret-preserving merge", () => {
    it("renames a connection without losing the password", async () => {
      const store = await freshStore(dataDir);
      const c = store.saveConnection({
        tech: "postgres",
        name: "old name",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      const updated = store.updateConnection(c.id, { name: "new name" });
      expect(updated?.name).toBe("new name");
      expect(
        (updated?.config as { password: string }).password,
      ).toBe("pg-secret-pw");
    });

    it("keeps the existing password when patch sends '' (the 'leave blank' UX)", async () => {
      const store = await freshStore(dataDir);
      const c = store.saveConnection({
        tech: "postgres",
        name: "x",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      const updated = store.updateConnection(c.id, {
        config: { ...POSTGRES_SAMPLE, password: "" },
      });
      expect((updated?.config as { password: string }).password).toBe(
        "pg-secret-pw",
      );
    });

    it("keeps the existing password when patch omits the field entirely", async () => {
      const store = await freshStore(dataDir);
      const c = store.saveConnection({
        tech: "postgres",
        name: "x",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      const { password: _drop, ...withoutPassword } = POSTGRES_SAMPLE;
      void _drop;
      const updated = store.updateConnection(c.id, { config: withoutPassword });
      expect((updated?.config as { password: string }).password).toBe(
        "pg-secret-pw",
      );
    });

    it("DOES rotate the password when patch sends a new non-empty value", async () => {
      const store = await freshStore(dataDir);
      const c = store.saveConnection({
        tech: "postgres",
        name: "x",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      const updated = store.updateConnection(c.id, {
        config: { ...POSTGRES_SAMPLE, password: "rotated-pw" },
      });
      expect((updated?.config as { password: string }).password).toBe(
        "rotated-pw",
      );
    });

    it("recurses into nested SASL when keeping the Kafka SASL password blank", async () => {
      const store = await freshStore(dataDir);
      const c = store.saveConnection({
        tech: "kafka",
        name: "k",
        config: KAFKA_SAMPLE,
        status: "ok",
      });
      const updated = store.updateConnection(c.id, {
        config: {
          ...KAFKA_SAMPLE,
          sasl: { ...KAFKA_SAMPLE.sasl, password: "" },
        },
      });
      expect(
        (updated?.config as typeof KAFKA_SAMPLE).sasl?.password,
      ).toBe("kafka-secret-pw");
    });

    it("trims the new name and falls back to existing on empty/whitespace", async () => {
      const store = await freshStore(dataDir);
      const c = store.saveConnection({
        tech: "postgres",
        name: "Original",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      expect(store.updateConnection(c.id, { name: "   " })?.name).toBe(
        "Original",
      );
      expect(store.updateConnection(c.id, { name: "  Trimmed  " })?.name).toBe(
        "Trimmed",
      );
    });

    it("flips status to 'untested' on any patch", async () => {
      const store = await freshStore(dataDir);
      const c = store.saveConnection({
        tech: "postgres",
        name: "x",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      const updated = store.updateConnection(c.id, { name: "rename" });
      expect(updated?.status).toBe("untested");
      expect(updated?.lastError).toBeUndefined();
    });

    it("persists the merged config to disk (so it survives restart)", async () => {
      const dir = dataDir;
      const first = await freshStore(dir);
      const c = first.saveConnection({
        tech: "postgres",
        name: "x",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      first.updateConnection(c.id, {
        config: { ...POSTGRES_SAMPLE, password: "rotated" },
      });

      const second = await freshStore(dir);
      const loaded = second.getConnection(c.id);
      expect((loaded?.config as { password: string }).password).toBe("rotated");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe("deleteConnection", () => {
    it("removes the record and flushes the new state to disk", async () => {
      const store = await freshStore(dataDir);
      const c = store.saveConnection({
        tech: "postgres",
        name: "x",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      expect(store.deleteConnection(c.id)).toBe(true);
      expect(store.getConnection(c.id)).toBeUndefined();
      const written = JSON.parse(
        readSecretFileSync(join(dataDir, "connections.json"))!,
      );
      expect(written.connections).toEqual([]);
    });

    it("returns false for an unknown id and does not flush", async () => {
      const store = await freshStore(dataDir);
      expect(store.deleteConnection("nope")).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe("listConnections", () => {
    it("filters by tech when a tech arg is passed", async () => {
      const store = await freshStore(dataDir);
      store.saveConnection({
        tech: "postgres",
        name: "p1",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      store.saveConnection({
        tech: "kafka",
        name: "k1",
        config: KAFKA_SAMPLE,
        status: "ok",
      });
      store.saveConnection({
        tech: "postgres",
        name: "p2",
        config: POSTGRES_SAMPLE,
        status: "ok",
      });
      expect(store.listConnections("postgres")).toHaveLength(2);
      expect(store.listConnections("kafka")).toHaveLength(1);
      expect(store.listConnections()).toHaveLength(3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  describe("ownerId + listConnectionsForUser", () => {
    const admin = { id: "u-admin", role: "admin" as const };
    const alice = { id: "u-alice", role: "member" as const };
    const bob = { id: "u-bob", role: "member" as const };

    function resetAccessCache() {
      delete (globalThis as Record<symbol, unknown>)[
        Symbol.for("baklava.connectionAccess")
      ];
    }

    it("saveConnection records the ownerId when provided", async () => {
      const store = await freshStore(dataDir);
      const c = store.saveConnection({
        tech: "postgres",
        name: "owned",
        config: POSTGRES_SAMPLE,
        status: "ok",
        ownerId: alice.id,
      });
      expect(c.ownerId).toBe(alice.id);
      expect(store.getConnection(c.id)?.ownerId).toBe(alice.id);
    });

    it("admin sees all connections regardless of owner", async () => {
      resetAccessCache();
      const store = await freshStore(dataDir);
      store.saveConnection({ tech: "postgres", name: "a", config: POSTGRES_SAMPLE, status: "ok", ownerId: alice.id });
      store.saveConnection({ tech: "postgres", name: "b", config: POSTGRES_SAMPLE, status: "ok", ownerId: bob.id });
      store.saveConnection({ tech: "postgres", name: "legacy", config: POSTGRES_SAMPLE, status: "ok" });
      expect(store.listConnectionsForUser(undefined, admin)).toHaveLength(3);
    });

    it("member sees owned ∪ granted, legacy (no owner) excluded", async () => {
      resetAccessCache();
      const store = await freshStore(dataDir);
      const access = await import("./access");
      access._resetAccessCacheForTests();

      const owned = store.saveConnection({ tech: "postgres", name: "owned", config: POSTGRES_SAMPLE, status: "ok", ownerId: alice.id });
      const granted = store.saveConnection({ tech: "postgres", name: "granted", config: POSTGRES_SAMPLE, status: "ok", ownerId: bob.id });
      store.saveConnection({ tech: "postgres", name: "bobs", config: POSTGRES_SAMPLE, status: "ok", ownerId: bob.id });
      store.saveConnection({ tech: "postgres", name: "legacy", config: POSTGRES_SAMPLE, status: "ok" });

      access.setGrants(granted.id, { [alice.id]: "read" });

      const visible = store.listConnectionsForUser(undefined, alice);
      const ids = visible.map((c) => c.id).sort();
      expect(ids).toEqual([owned.id, granted.id].sort());
    });

    it("member listing respects the tech filter", async () => {
      resetAccessCache();
      const store = await freshStore(dataDir);
      const access = await import("./access");
      access._resetAccessCacheForTests();
      store.saveConnection({ tech: "postgres", name: "p", config: POSTGRES_SAMPLE, status: "ok", ownerId: alice.id });
      store.saveConnection({ tech: "kafka", name: "k", config: KAFKA_SAMPLE, status: "ok", ownerId: alice.id });
      expect(store.listConnectionsForUser("postgres", alice)).toHaveLength(1);
      expect(store.listConnectionsForUser("kafka", alice)).toHaveLength(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Redaction — critical for not leaking passwords over the API.
//
// This block tests the CURRENT behavior of redactConfig (which only masks
// `password` + `sasl.password`). If/when redactConfig is fixed to cover the
// full SECRET_KEYS set, several of the "leaks plaintext" assertions below
// will start failing — that's the signal to flip them to `not.toMatch`.
// ─────────────────────────────────────────────────────────────────────────────
describe("redactConfig + publicView", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-redact-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("masks top-level password with bullets matching the length (capped at 8)", async () => {
    const { redactConfig } = await freshStore(dataDir);
    const out = redactConfig({ password: "abc" });
    expect(out.password).toBe("•••");
    const long = redactConfig({ password: "x".repeat(50) });
    expect(long.password).toBe("•".repeat(8));
  });

  it("masks Kafka SASL nested password (the documented Kafka leak vector)", async () => {
    const { redactConfig } = await freshStore(dataDir);
    const out = redactConfig({
      brokers: ["x"],
      sasl: { mechanism: "plain", username: "u", password: "secret" },
    });
    const sasl = (out as { sasl: { password: string } }).sasl;
    expect(sasl.password).toBe("••••••");
  });

  it("leaves empty/missing passwords alone", async () => {
    const { redactConfig } = await freshStore(dataDir);
    expect(
      (redactConfig({} as { password?: string })).password,
    ).toBeUndefined();
    expect(redactConfig({ password: "" }).password).toBe("");
  });

  it("returns a new object (does not mutate the input)", async () => {
    const { redactConfig } = await freshStore(dataDir);
    const input = { password: "abc" };
    const out = redactConfig(input);
    expect(out).not.toBe(input);
    expect(input.password).toBe("abc");
  });

  it("publicView wraps the record with a redacted config field", async () => {
    const { saveConnection, publicView } = await freshStore(dataDir);
    const saved = saveConnection({
      tech: "postgres",
      name: "x",
      config: POSTGRES_SAMPLE,
      status: "ok",
    });
    const pv = publicView(saved);
    expect(pv.id).toBe(saved.id);
    expect(pv.name).toBe(saved.name);
    expect((pv.config as { password: string }).password).not.toBe(
      "pg-secret-pw",
    );
    expect((pv.config as { password: string }).password).toMatch(/^•+$/);
  });

  // ────────────────────────────────────────────────────────────────────
  // Every secret key listed in SECRET_KEYS must be masked through publicView.
  // ────────────────────────────────────────────────────────────────────
  describe("redacts every secret key, not just password", () => {
    it("leaves non-secret keys untouched (no over-redaction)", async () => {
      const { redactConfig } = await freshStore(dataDir);
      const out = redactConfig({
        host: "localhost",
        port: 5432,
        database: "postgres",
        user: "postgres",
        password: "shh",
        ssl: false,
      });
      expect(out.host).toBe("localhost");
      expect(out.port).toBe(5432);
      expect(out.database).toBe("postgres");
      expect(out.user).toBe("postgres");
      expect(out.ssl).toBe(false);
      expect(out.password).toMatch(/^•+$/);
    });
  });
});
