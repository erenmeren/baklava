import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getLoadTest, type LoadTest } from "./store";

// Load tests are personal. The workspace pages must scope to the acting user the
// same way the API routes do: resolve the current user from the request headers
// and only return a test they own. A non-owner (or unauthenticated) request
// 404s — the page never renders another user's saved test (name, target, etc.).
export async function requireLoadTest(id: string): Promise<LoadTest> {
  const user = getCurrentUser({ headers: await headers() });
  const test = user ? getLoadTest(id, user.id) : undefined;
  if (!test) notFound();
  return test;
}
