"use client";

import { useState } from "react";
import { ConnectionsList } from "@/components/connections-list";
import { connectionSummaries } from "@/lib/connections/summaries";
import { PostgresForm } from "./postgres-form";

export function PostgresClient() {
  const [refresh, setRefresh] = useState(0);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
      <PostgresForm onSaved={() => setRefresh((n) => n + 1)} />
      <section>
        <h2 className="font-semibold mb-3">Saved connections</h2>
        <ConnectionsList
          tech="postgres"
          refreshKey={refresh}
          renderSummary={connectionSummaries.postgres}
        />
      </section>
    </div>
  );
}
