import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatError } from "@/lib/errors";
import { savedLoadTestConfigSchema } from "@/lib/loadtest/store-schema";
import { listLoadTests, publicLoadTest, saveLoadTest } from "@/lib/loadtest/store";

export const runtime = "nodejs";

// Load tests are personal — they hold runnable secrets (bearer tokens,
// basic-auth, etc.). Every handler resolves the acting user and scopes strictly
// to them; admins do NOT cross-browse.
export async function GET(req: Request) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ loadtests: listLoadTests(user.id).map(publicLoadTest) });
}

const createSchema = z.object({
  name: z.string().min(1),
  config: savedLoadTestConfigSchema,
});

export async function POST(req: Request) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  try {
    const saved = saveLoadTest(user.id, { name: parsed.data.name, config: parsed.data.config });
    return NextResponse.json({ loadtest: publicLoadTest(saved) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}
