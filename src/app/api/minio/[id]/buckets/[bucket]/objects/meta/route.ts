import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
export const GET = blobHandlers("minio").meta;
