import { requireUser, authErrorResponse } from "@/lib/auth/current-user";
import { publicUser } from "@/lib/auth/users";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const user = requireUser(req);
    return Response.json({ user: publicUser(user) });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
