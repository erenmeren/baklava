import { getLoadTest, getRun } from "@/lib/loadtest/store";
import { renderRunPdf } from "@/lib/loadtest/pdf-report";
import { exportFilename } from "@/lib/loadtest/run-export";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { id, runId } = await ctx.params;
  const test = getLoadTest(id);
  const run = test ? getRun(id, runId) : undefined;
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
