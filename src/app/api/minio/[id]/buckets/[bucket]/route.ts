import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
export const DELETE = blobHandlers("minio").deleteBucket;
