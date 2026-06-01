import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
const h = blobHandlers("r2");
export const GET = h.listObjects;
export const DELETE = h.bulkDelete;
