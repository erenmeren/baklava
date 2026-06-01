import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
export const POST = blobHandlers("minio").copy;
