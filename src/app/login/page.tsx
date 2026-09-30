import { listUsers, needsSetup } from "@/lib/auth/users";
import { LoginClient } from "./login-client";
import { getSetupToken } from "@/lib/auth/setup-token";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Unconfigured console → show the create-password form instead of sign-in.
  const mode: "login" | "setup" = needsSetup() ? "setup" : "login";
  // Mint (and print to the server's output) the one-time setup token.
  if (mode === "setup") getSetupToken();
  // With more than one user, sign-in needs to know *who* is signing in.
  const multiUser = listUsers().length > 1;

  return (
    <div className="flex min-h-[calc(100vh-0px)] items-center justify-center p-6">
      <LoginClient mode={mode} multiUser={multiUser} />
    </div>
  );
}
