import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import type { CORSRule, LifecycleRule, S3Client } from "@aws-sdk/client-s3";
import { getConnection, saveConnection, publicView } from "@/lib/connections/store";
import { formatError } from "@/lib/errors";
import type { TechId } from "./types";
import { blobTech } from "./blob-registry";
import * as s3 from "./s3";

type Ctx = { params: Promise<Record<string, string>> };

export function blobHandlers(tech: TechId) {
  const bt = blobTech(tech)!;

  /** Resolve the connection + client, or return a 404 response. */
  async function resolve(id: string): Promise<
    | { ok: true; rec: ReturnType<typeof getConnection> & object; client: S3Client }
    | { ok: false; res: NextResponse }
  > {
    const rec = getConnection(id);
    if (!rec || rec.tech !== tech) return { ok: false, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
    return { ok: true, rec, client: await bt.clientFor(id, rec.config) };
  }

  return {
    async test(req: NextRequest) {
      let body: { name?: string; config?: unknown; save?: boolean };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      const cfg = body?.config;
      const invalid = bt.validateConfig(cfg);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
      const probeId = `__probe_${Math.random().toString(36).slice(2)}`;
      try {
        const client = await bt.clientFor(probeId, cfg);
        const { buckets } = await s3.probe(client);
        const record = body.save
          ? saveConnection({ tech, name: body.name || bt.defaultName, config: cfg as Record<string, unknown>, status: "ok" })
          : null;
        return NextResponse.json({
          ok: true,
          probe: { buckets, endpoint: bt.endpointOf(cfg) },
          connection: record ? publicView(record) : null,
        });
      } catch (err) {
        return NextResponse.json({ ok: false, error: formatError(err) }, { status: 200 });
      } finally {
        bt.dropClient(probeId);
      }
    },

    async listBuckets(_req: NextRequest, ctx: Ctx) {
      const { id } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      try { return NextResponse.json({ buckets: await s3.listBuckets(r.client) }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 500 }); }
    },

    async createBucket(req: NextRequest, ctx: Ctx) {
      const { id } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      let body: { name?: string };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      try { await s3.createBucket(r.client, body.name?.trim() ?? "", { lax: tech === "minio" }); return NextResponse.json({ ok: true, name: body.name?.trim() }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async deleteBucket(_req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      try { await s3.deleteBucket(r.client, bucket); return NextResponse.json({ ok: true }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async listObjects(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      const prefix = req.nextUrl.searchParams.get("prefix") ?? "";
      const token = req.nextUrl.searchParams.get("token");
      try { return NextResponse.json(await s3.listObjects(r.client, bucket, prefix, token)); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 500 }); }
    },

    async bulkDelete(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      let body: { keys?: string[] };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      try { await s3.deleteObjects(r.client, bucket, body.keys ?? []); return NextResponse.json({ ok: true, deleted: body.keys?.length ?? 0 }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async upload(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      let form: FormData;
      try { form = await req.formData(); } catch { return NextResponse.json({ error: "Expected multipart form" }, { status: 400 }); }
      const file = form.get("file");
      const key = String(form.get("key") ?? "");
      if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
      try {
        const nodeStream = Readable.fromWeb(file.stream() as unknown as import("node:stream/web").ReadableStream);
        await s3.uploadObject(r.client, bucket, key, nodeStream, file.type || "application/octet-stream");
        return NextResponse.json({ ok: true, key });
      } catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async download(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      const key = req.nextUrl.searchParams.get("key") ?? "";
      try { return NextResponse.redirect(await s3.presignGet(r.client, bucket, key, 300), 302); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async meta(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      const key = req.nextUrl.searchParams.get("key") ?? "";
      try { return NextResponse.json(await s3.headObject(r.client, bucket, key)); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async presign(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      let body: { key?: string; expiresIn?: number };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      try { return NextResponse.json({ url: await s3.presignGet(r.client, bucket, body.key ?? "", Math.min(body.expiresIn ?? 3600, 604800)) }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async copy(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      let body: { from?: string; to?: string; move?: boolean };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      const from = body.from ?? "", to = body.to ?? "";
      try {
        await s3.copyObject(r.client, bucket, from, to);
        if (body.move && from !== to) await s3.deleteObjects(r.client, bucket, [from]);
        return NextResponse.json({ ok: true, to });
      } catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async getCors(_req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      try { return NextResponse.json({ rules: await s3.getBucketCors(r.client, bucket) }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 500 }); }
    },
    async putCors(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      let body: { rules?: CORSRule[] };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      try { await s3.putBucketCors(r.client, bucket, body.rules ?? []); return NextResponse.json({ ok: true }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async getLifecycle(_req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      try { return NextResponse.json({ rules: await s3.getBucketLifecycle(r.client, bucket) }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 500 }); }
    },
    async putLifecycle(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = await resolve(id); if (!r.ok) return r.res;
      let body: { rules?: LifecycleRule[] };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      try { await s3.putBucketLifecycle(r.client, bucket, body.rules ?? []); return NextResponse.json({ ok: true }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },
  };
}
