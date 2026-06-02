import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
const h = blobHandlers("s3");
export const GET = h.getCors;
export const PUT = h.putCors;
