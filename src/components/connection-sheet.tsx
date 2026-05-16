"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ConnectionsList } from "@/components/connections-list";
import { connectionSummaries } from "@/lib/connections/summaries";
import type { TechId } from "@/lib/connections/types";
import { techIconUrl, type TechMeta } from "@/lib/tech-catalog";
import { DockerForm } from "@/app/docker/docker-form";
import { PostgresForm } from "@/app/postgres/postgres-form";
import { KafkaForm } from "@/app/kafka/kafka-form";
import { RedisForm } from "@/app/redis/redis-form";
import { MysqlForm } from "@/app/mysql/mysql-form";
import { SqlServerForm } from "@/app/sqlserver/sqlserver-form";
import { MongoForm } from "@/app/mongo/mongo-form";
import { RabbitForm } from "@/app/rabbit/rabbit-form";
import { ElasticForm } from "@/app/elastic/elastic-form";
import { ClickhouseForm } from "@/app/clickhouse/clickhouse-form";
import { NatsForm } from "@/app/nats/nats-form";
import { SqliteForm } from "@/app/sqlite/sqlite-form";
import { EtcdForm } from "@/app/etcd/etcd-form";
import { KubernetesForm } from "@/app/kubernetes/kubernetes-form";

interface Props {
  tech: TechMeta | null;
  onOpenChange: (open: boolean) => void;
}

const FORMS: Record<TechId, React.ComponentType<{ onSaved?: () => void }>> = {
  docker: DockerForm,
  postgres: PostgresForm,
  kafka: KafkaForm,
  redis: RedisForm,
  mysql: MysqlForm,
  sqlserver: SqlServerForm,
  mongo: MongoForm,
  rabbit: RabbitForm,
  elastic: ElasticForm,
  clickhouse: ClickhouseForm,
  nats: NatsForm,
  sqlite: SqliteForm,
  etcd: EtcdForm,
  kubernetes: KubernetesForm,
};

export function ConnectionSheet({ tech, onOpenChange }: Props) {
  const [view, setView] = useState<"list" | "form">("list");
  const [refresh, setRefresh] = useState(0);

  // Reset to the list view whenever a different tech is selected.
  useEffect(() => {
    if (tech) setView("list");
  }, [tech]);

  const open = !!tech;
  const techId = tech?.id as TechId | undefined;
  const Form = techId ? FORMS[techId] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="p-5 pb-4 border-b border-border/60">
          {tech ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={techIconUrl(tech)}
                alt=""
                className="size-9 select-none dark:brightness-0 dark:invert"
                aria-hidden
                draggable={false}
              />
              <div>
                <SheetTitle className="text-base">{tech.name}</SheetTitle>
                <SheetDescription className="text-xs">
                  {tech.tagline}
                </SheetDescription>
              </div>
            </div>
          ) : (
            <SheetTitle className="sr-only">Connections</SheetTitle>
          )}
        </SheetHeader>

        {techId && Form ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {view === "list" ? (
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Saved connections</h3>
                  <Button size="sm" onClick={() => setView("form")}>
                    <Plus className="size-3.5" />
                    New connection
                  </Button>
                </div>
                <ConnectionsList
                  tech={techId}
                  refreshKey={refresh}
                  renderSummary={connectionSummaries[techId]}
                  emptyState={
                    <span>
                      No saved connections yet — click{" "}
                      <span className="font-medium text-foreground">
                        New connection
                      </span>{" "}
                      to add one.
                    </span>
                  }
                />
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setView("list")}
                  className="-ml-2"
                >
                  <ArrowLeft className="size-3.5" />
                  Back to connections
                </Button>
                <Form
                  onSaved={() => {
                    setRefresh((n) => n + 1);
                    setView("list");
                  }}
                />
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
