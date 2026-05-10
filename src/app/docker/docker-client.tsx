"use client";

import { useState } from "react";
import { ConnectionsList } from "@/components/connections-list";
import { connectionSummaries } from "@/lib/connections/summaries";
import { DockerForm } from "./docker-form";

export function DockerClient() {
  const [refresh, setRefresh] = useState(0);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
      <DockerForm onSaved={() => setRefresh((n) => n + 1)} />
      <section>
        <h2 className="font-semibold mb-3">Saved connections</h2>
        <ConnectionsList
          tech="docker"
          refreshKey={refresh}
          renderSummary={connectionSummaries.docker}
        />
      </section>
    </div>
  );
}
