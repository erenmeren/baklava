import { listUsers, needsSetup } from "@/lib/auth/users";
import { LoginClient } from "./login-client";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Unconfigured console → show the create-password form instead of sign-in.
  const mode: "login" | "setup" = needsSetup() ? "setup" : "login";
  // With more than one user, sign-in needs to know *who* is signing in.
  const multiUser = listUsers().length > 1;

  return (
    <div className="flex min-h-[calc(100vh-0px)] items-center justify-center p-6">
      <LoginClient mode={mode} multiUser={multiUser} />
    </div>
  );
}
