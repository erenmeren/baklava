import { needsSetup } from "@/lib/auth/store";
import { LoginClient } from "./login-client";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Unconfigured console → show the create-password form instead of sign-in.
  const mode: "login" | "setup" = needsSetup() ? "setup" : "login";

  return (
    <div className="flex min-h-[calc(100vh-0px)] items-center justify-center p-6">
      <LoginClient mode={mode} />
    </div>
  );
}
