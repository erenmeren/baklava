"use client";

import { useState } from "react";
import { ConnectionsList } from "@/components/connections-list";
import { connectionSummaries } from "@/lib/connections/summaries";
import { KafkaForm } from "./kafka-form";

export function KafkaClient() {
  const [refresh, setRefresh] = useState(0);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
      <KafkaForm onSaved={() => setRefresh((n) => n + 1)} />
      <section>
        <h2 className="font-semibold mb-3">Saved connections</h2>
        <ConnectionsList
          tech="kafka"
          refreshKey={refresh}
          renderSummary={connectionSummaries.kafka}
        />
      </section>
    </div>
  );
}
