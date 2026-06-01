import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
export const DELETE = blobHandlers("r2").deleteBucket;
