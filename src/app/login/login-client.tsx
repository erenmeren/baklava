"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { BrandMark } from "@/components/brand-mark";
import { Loader2 } from "lucide-react";

type Mode = "login" | "setup";

export function LoginClient({
  mode,
  multiUser = false,
}: {
  mode: Mode;
  multiUser?: boolean;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(multiUser ? { username, password } : { password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Sign-in failed");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not set password");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="flex items-center gap-2 text-foreground/90">
          <BrandMark size={22} />
          <span className="font-semibold tracking-tight">baklava</span>
        </div>
        <CardTitle className="pt-2">
          {mode === "login" ? "Sign in" : "Create a password"}
        </CardTitle>
        <CardDescription>
          {mode === "login"
            ? "Enter the password to access this console."
            : "Set a password to protect this console."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {mode === "login" ? (
          <form onSubmit={submitLogin} className="space-y-4">
            {multiUser ? (
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  autoFocus
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoFocus={!multiUser}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </div>
            {error ? (
              <p className="text-sm text-rose-500">{error}</p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={busy || !password || (multiUser && !username)}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitSetup} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                You&apos;ll sign in with this. You can add more users later.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">Password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
              />
            </div>
            {error ? (
              <p className="text-sm text-rose-500">{error}</p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={busy || !username || !newPassword || !confirm}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Create password & continue"
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
