import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeClient = { __s3: true };
// Toggle to simulate a tech with no registered blob client.
const mockState = { noClient: false };

vi.mock("@/lib/connections/blob-registry", () => ({
  blobTech: () => (mockState.noClient ? undefined : { clientFor: () => fakeClient }),
}));

vi.mock("@/lib/connections/s3", () => ({
  listBuckets: vi.fn(async () => []),
  createBucket: vi.fn(async () => undefined),
  deleteBucket: vi.fn(async () => undefined),
  listObjects: vi.fn(async () => ({ prefix: "", folders: [], objects: [], nextToken: null })),
  headObject: vi.fn(async () => ({})),
  uploadObject: vi.fn(async () => undefined),
  copyObject: vi.fn(async () => undefined),
  deleteObjects: vi.fn(async () => undefined),
  getBucketCors: vi.fn(async () => []),
  putBucketCors: vi.fn(async () => undefined),
  getBucketLifecycle: vi.fn(async () => []),
  putBucketLifecycle: vi.fn(async () => undefined),
}));

import * as s3 from "@/lib/connections/s3";
import { blobTools } from "./blob";

const cfg = { accountId: "a", accessKeyId: "k", secretAccessKey: "s" };
const tools = () => blobTools("r2", "c1", cfg);
const get = (name: string) => tools().find((t) => t.name === name)!;

describe("blobTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tags categories (read/write/destructive)", () => {
    const cat = Object.fromEntries(tools().map((t) => [t.name, t.category]));
    expect(cat["blob_list_buckets"]).toBe("read");
    expect(cat["blob_head_object"]).toBe("read");
    expect(cat["blob_get_cors"]).toBe("read");
    expect(cat["blob_upload_object"]).toBe("write");
    expect(cat["blob_copy_object"]).toBe("write");
    expect(cat["blob_put_cors"]).toBe("write");
    // Lifecycle is destructive: an Expiration rule can delete objects.
    expect(cat["blob_put_lifecycle"]).toBe("destructive");
    expect(cat["blob_delete_objects"]).toBe("destructive");
    expect(cat["blob_delete_bucket"]).toBe("destructive");
    expect(cat["blob_move_object"]).toBe("destructive");
  });

  it("exposes no content-read or presigned-url tool", () => {
    const names = tools().map((t) => t.name);
    expect(names.some((n) => /presign|download|read_object|get_object|content/i.test(n))).toBe(false);
  });

  it("blob_head_object returns metadata only (delegates to headObject)", async () => {
    await get("blob_head_object").execute({ bucket: "b", key: "k" });
    expect(s3.headObject).toHaveBeenCalledWith(fakeClient, "b", "k");
  });

  it("blob_list_objects delegates with prefix/token defaults", async () => {
    await get("blob_list_objects").execute({ bucket: "b" });
    expect(s3.listObjects).toHaveBeenCalledWith(fakeClient, "b", "", null);
  });

  it("blob_create_bucket sets lax for minio, strict otherwise", async () => {
    await blobTools("minio", "c1", cfg).find((t) => t.name === "blob_create_bucket")!.execute({ name: "b" });
    expect(s3.createBucket).toHaveBeenCalledWith(fakeClient, "b", { lax: true });
    vi.clearAllMocks();
    await get("blob_create_bucket").execute({ name: "b" });
    expect(s3.createBucket).toHaveBeenCalledWith(fakeClient, "b", { lax: false });
  });

  it("blob_upload_object uploads a small text body as a Buffer", async () => {
    await get("blob_upload_object").execute({ bucket: "b", key: "k.txt", content: "hello" });
    expect(s3.uploadObject).toHaveBeenCalledWith(fakeClient, "b", "k.txt", expect.any(Buffer), "text/plain");
  });

  it("blob_upload_object rejects a non-text content-type without uploading", async () => {
    await expect(
      get("blob_upload_object").execute({ bucket: "b", key: "k.bin", content: "x", contentType: "application/octet-stream" }),
    ).rejects.toThrow(/text-only/i);
    expect(s3.uploadObject).not.toHaveBeenCalled();
  });

  it("blob_upload_object rejects an oversized body without uploading", async () => {
    const big = "x".repeat(256 * 1024 + 1);
    await expect(get("blob_upload_object").execute({ bucket: "b", key: "k.txt", content: big })).rejects.toThrow(/limit/i);
    expect(s3.uploadObject).not.toHaveBeenCalled();
  });

  it("blob_move_object copies then deletes the source, in that order", async () => {
    const order: string[] = [];
    (s3.copyObject as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push("copy"); });
    (s3.deleteObjects as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push("delete"); });
    await get("blob_move_object").execute({ bucket: "b", from: "a.txt", to: "b.txt" });
    expect(s3.copyObject).toHaveBeenCalledWith(fakeClient, "b", "a.txt", "b.txt");
    expect(s3.deleteObjects).toHaveBeenCalledWith(fakeClient, "b", ["a.txt"]);
    expect(order).toEqual(["copy", "delete"]);
  });

  it("blob_move_object reports a duplicate if the source delete fails after copy", async () => {
    (s3.deleteObjects as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("access denied"));
    await expect(
      get("blob_move_object").execute({ bucket: "b", from: "a.txt", to: "b.txt" }),
    ).rejects.toThrow(/duplicate now exists at "b\.txt"/i);
    expect(s3.copyObject).toHaveBeenCalled();
  });

  it("blob_upload_object accepts a non-default text content-type (application/json)", async () => {
    await get("blob_upload_object").execute({ bucket: "b", key: "c.json", content: "{}", contentType: "application/json" });
    expect(s3.uploadObject).toHaveBeenCalledWith(fakeClient, "b", "c.json", expect.any(Buffer), "application/json");
  });

  it("read/write/destructive tools delegate to their s3 op", async () => {
    await get("blob_list_buckets").execute({});
    expect(s3.listBuckets).toHaveBeenCalledWith(fakeClient);
    await get("blob_get_cors").execute({ bucket: "b" });
    expect(s3.getBucketCors).toHaveBeenCalledWith(fakeClient, "b");
    await get("blob_get_lifecycle").execute({ bucket: "b" });
    expect(s3.getBucketLifecycle).toHaveBeenCalledWith(fakeClient, "b");
    await get("blob_copy_object").execute({ bucket: "b", from: "a", to: "c" });
    expect(s3.copyObject).toHaveBeenCalledWith(fakeClient, "b", "a", "c");
    await get("blob_put_cors").execute({ bucket: "b", rules: [{ AllowedMethods: ["GET"] }] });
    expect(s3.putBucketCors).toHaveBeenCalledWith(fakeClient, "b", [{ AllowedMethods: ["GET"] }]);
    await get("blob_put_lifecycle").execute({ bucket: "b", rules: [{ ID: "x", Status: "Enabled" }] });
    expect(s3.putBucketLifecycle).toHaveBeenCalledWith(fakeClient, "b", [{ ID: "x", Status: "Enabled" }]);
    await get("blob_delete_objects").execute({ bucket: "b", keys: ["a", "c"] });
    expect(s3.deleteObjects).toHaveBeenCalledWith(fakeClient, "b", ["a", "c"]);
    await get("blob_delete_bucket").execute({ bucket: "b" });
    expect(s3.deleteBucket).toHaveBeenCalledWith(fakeClient, "b");
  });

  it("throws a clear error when the tech has no blob client", async () => {
    mockState.noClient = true;
    try {
      await expect(get("blob_list_buckets").execute({})).rejects.toThrow(/no blob client/i);
    } finally {
      mockState.noClient = false;
    }
  });
});
