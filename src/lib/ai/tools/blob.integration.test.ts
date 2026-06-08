/**
 * Integration test: drives the actual AI `blob_*` tools (the exact code the assistant
 * calls) against a REAL MinIO. Gated by BAKLAVA_INTEGRATION=1; skips itself if
 * MinIO isn't reachable on localhost:9000.
 *
 *   docker run -d --name minio -p 9000:9000 \
 *     -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin123 \
 *     quay.io/minio/minio server /data
 *   BAKLAVA_INTEGRATION=1 npx vitest run src/lib/ai/tools/blob.integration.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { reachable } from "@/test/integration-helpers";
import { blobTools } from "./blob";
import type { AiTool } from "./types";

const HOST = "localhost";
const PORT = 9000;

const cfg = {
  endpoint: process.env.BAKLAVA_MINIO_ENDPOINT ?? "localhost:9000",
  useSSL: false,
  accessKey: process.env.BAKLAVA_MINIO_AK ?? "minioadmin",
  secretKey: process.env.BAKLAVA_MINIO_SK ?? "minioadmin123",
  region: "us-east-1",
};

const tools = blobTools("minio", "integration-conn", cfg);
const tool = (name: string): AiTool => {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
// Unique bucket per run so reruns don't collide. Date.now() is allowed in tests.
const stamp = Date.now().toString(36);

describe("blob tools against real MinIO", async () => {
  const up = await reachable(HOST, PORT);
  beforeAll(() => {
    if (!up) console.warn(`[skip] MinIO not reachable on ${HOST}:${PORT}`);
  });

  it.skipIf(!up)(
    "full object lifecycle: create → upload → head → list → copy → move → delete → drop bucket",
    async () => {
      const bucket = `integration-${stamp}`;

      await tool("blob_create_bucket").execute({ name: bucket });

      const buckets = (await tool("blob_list_buckets").execute({})) as { name: string }[];
      expect(buckets.some((b) => b.name === bucket)).toBe(true);

      const uploaded = await tool("blob_upload_object").execute({
        bucket,
        key: "notes/a.txt",
        content: "hello integration",
        contentType: "text/plain",
      });
      expect(uploaded).toMatchObject({ uploaded: { bucket, key: "notes/a.txt" } });

      const meta = (await tool("blob_head_object").execute({ bucket, key: "notes/a.txt" })) as {
        size: number;
        contentType: string | null;
      };
      expect(meta.size).toBe(Buffer.byteLength("hello integration", "utf8"));
      expect(meta.contentType).toMatch(/text\/plain/);

      const listing = (await tool("blob_list_objects").execute({ bucket, prefix: "notes/" })) as {
        objects: { key: string }[];
      };
      expect(listing.objects.some((o) => o.key === "notes/a.txt")).toBe(true);

      await tool("blob_copy_object").execute({ bucket, from: "notes/a.txt", to: "notes/copy.txt" });
      const afterCopy = (await tool("blob_list_objects").execute({ bucket, prefix: "notes/" })) as {
        objects: { key: string }[];
      };
      expect(afterCopy.objects.map((o) => o.key).sort()).toEqual(["notes/a.txt", "notes/copy.txt"]);

      await tool("blob_move_object").execute({ bucket, from: "notes/copy.txt", to: "notes/moved.txt" });
      const afterMove = (await tool("blob_list_objects").execute({ bucket, prefix: "notes/" })) as {
        objects: { key: string }[];
      };
      // copy.txt removed (source of the move), moved.txt present.
      expect(afterMove.objects.map((o) => o.key).sort()).toEqual(["notes/a.txt", "notes/moved.txt"]);

      await tool("blob_delete_objects").execute({ bucket, keys: ["notes/a.txt", "notes/moved.txt"] });
      const empty = (await tool("blob_list_objects").execute({ bucket, prefix: "notes/" })) as {
        objects: unknown[];
      };
      expect(empty.objects.length).toBe(0);

      await tool("blob_delete_bucket").execute({ bucket });
      const finalBuckets = (await tool("blob_list_buckets").execute({})) as { name: string }[];
      expect(finalBuckets.some((b) => b.name === bucket)).toBe(false);
    },
    30000,
  );

  it.skipIf(!up)("upload guard rejects binary content-type and oversized bodies", async () => {
    await expect(
      tool("blob_upload_object").execute({
        bucket: "anybucket",
        key: "k",
        content: "x",
        contentType: "application/octet-stream",
      }),
    ).rejects.toThrow(/text-only/i);

    await expect(
      tool("blob_upload_object").execute({ bucket: "anybucket", key: "k", content: "x".repeat(256 * 1024 + 1) }),
    ).rejects.toThrow(/limit/i);
  });

  it.skipIf(!up)("get_cors returns [] or a documented MinIO limitation, never a crash", async () => {
    const b = `cors-${stamp}`;
    await tool("blob_create_bucket").execute({ name: b });
    try {
      const cors = await tool("blob_get_cors").execute({ bucket: b });
      // MinIO either returns no CORS config ([]) or rejects the API.
      expect(Array.isArray(cors)).toBe(true);
    } catch (e) {
      expect(String(e)).toMatch(/NotImplemented|not implemented|cors/i);
    } finally {
      await tool("blob_delete_bucket").execute({ bucket: b });
    }
  }, 20000);
});
