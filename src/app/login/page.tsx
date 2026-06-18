import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { mustChangePassword } from "@/lib/auth/store";
import { LoginClient } from "./login-client";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const authed = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  // Authenticated but still on the bootstrap password → force the change form.
  const mode: "login" | "change" =
    authed && mustChangePassword() ? "change" : "login";

  return (
    <div className="flex min-h-[calc(100vh-0px)] items-center justify-center p-6">
      <LoginClient mode={mode} />
    </div>
  );
}
