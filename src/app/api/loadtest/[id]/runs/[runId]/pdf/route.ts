import { getCurrentUser } from "@/lib/auth/current-user";
import { getLoadTest, getRun } from "@/lib/loadtest/store";
import { renderRunPdf } from "@/lib/loadtest/pdf-report";
import { exportFilename } from "@/lib/loadtest/run-export";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

export async function GET(req: Request, ctx: RouteContext) {
  const user = getCurrentUser(req);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const { id, runId } = await ctx.params;
  const test = getLoadTest(id, user.id);
  const run = test ? getRun(id, user.id, runId) : undefined;
  if (!test || !run) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  try {
    const pdf = await renderRunPdf(test, run);
    const filename = `${exportFilename(test.name, run.id)}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return Response.json({ error: formatError(err) }, { status: 500 });
  }
}
