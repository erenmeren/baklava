import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LoadTestForm } from "@/app/loadtest/loadtest-form";

export const dynamic = "force-dynamic";

export default function NewLoadTestPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pt-6 pb-12 space-y-6">
      <div className="space-y-2">
        <Link
          href="/loadtest"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Load tests
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">New load test</h1>
          <p className="text-sm text-muted-foreground">
            Configure target, requests, auth, and load profile.
          </p>
        </div>
      </div>
      <LoadTestForm />
    </div>
  );
}
