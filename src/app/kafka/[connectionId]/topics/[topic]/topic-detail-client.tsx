"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  RefreshCcw,
  Send,
} from "lucide-react";

interface TopicDetail {
  name: string;
  partitions: {
    partition: number;
    leader: number;
    replicas: number[];
    isr: number[];
    high: string;
    low: string;
  }[];
  configs: { name: string; value: string; isDefault: boolean }[];
}

interface KafkaMessage {
  partition: number;
  offset: string;
  timestamp: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
}

interface Props {
  connectionId: string;
  topic: string;
}

export function TopicDetailClient({ connectionId, topic }: Props) {
  const base = `/api/kafka/${connectionId}/topics/${encodeURIComponent(topic)}`;
  const [tab, setTab] = useState("partitions");
  const [detail, setDetail] = useState<TopicDetail | null>(null);

  // messages tab
  const [messages, setMessages] = useState<KafkaMessage[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [partitionFilter, setPartitionFilter] = useState<string>("all");
  const [fromBeginning, setFromBeginning] = useState(true);

  // produce tab
  const [prodKey, setProdKey] = useState("");
  const [prodValue, setProdValue] = useState("");
  const [producing, setProducing] = useState(false);

  const loadDetail = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setDetail(data as TopicDetail);
    else toast.error("Could not load topic", { description: data.error });
  }, [base]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const loadMessages = useCallback(async () => {
    setLoadingMessages(true);
    setMessages(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "100");
      params.set("from", fromBeginning ? "beginning" : "end");
      if (partitionFilter !== "all") params.set("partition", partitionFilter);
      const res = await fetch(`${base}/messages?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setMessages(data.messages as KafkaMessage[]);
      else toast.error("Could not load messages", { description: data.error });
    } finally {
      setLoadingMessages(false);
    }
  }, [base, partitionFilter, fromBeginning]);

  useEffect(() => {
    if (tab === "messages" && messages === null) {
      loadMessages();
    }
  }, [tab, messages, loadMessages]);

  const produce = async () => {
    if (!prodValue) return;
    setProducing(true);
    try {
      const res = await fetch(`${base}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: prodKey || undefined,
          value: prodValue,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Message produced");
        setProdValue("");
      } else toast.error(data.error || "Could not produce");
    } finally {
      setProducing(false);
    }
  };

  return (
    <WorkspacePage
      title={<span className="font-mono">{topic}</span>}
      description={
        detail
          ? `${detail.partitions.length} partitions · ${detail.configs.length} configs`
          : undefined
      }
      actions={
        <Link
          href={`/kafka/${connectionId}/topics`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Link>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="partitions">Partitions</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="produce">Produce</TabsTrigger>
          <TabsTrigger value="configs">Configs</TabsTrigger>
        </TabsList>

        <TabsContent value="partitions" className="pt-4">
          {detail ? (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partition</TableHead>
                    <TableHead>Leader</TableHead>
                    <TableHead>Replicas</TableHead>
                    <TableHead>ISR</TableHead>
                    <TableHead>Low</TableHead>
                    <TableHead>High</TableHead>
                    <TableHead>Messages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.partitions.map((p) => (
                    <TableRow key={p.partition}>
                      <TableCell className="font-mono text-xs">
                        {p.partition}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.leader}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.replicas.join(", ")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.isr.join(", ")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.low}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.high}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {(Number(p.high) - Number(p.low)).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="messages" className="pt-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label htmlFor="part-sel" className="text-xs">
                Partition
              </Label>
              <select
                id="part-sel"
                value={partitionFilter}
                onChange={(e) => setPartitionFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              >
                <option value="all">All</option>
                {detail?.partitions.map((p) => (
                  <option key={p.partition} value={String(p.partition)}>
                    {p.partition}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={fromBeginning}
                onChange={(e) => setFromBeginning(e.target.checked)}
              />
              From beginning
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={loadMessages}
              disabled={loadingMessages}
            >
              {loadingMessages ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="size-3.5" />
              )}
              Fetch
            </Button>
            <span className="text-xs text-muted-foreground">
              up to 100 messages, 5s timeout
            </span>
          </div>

          {loadingMessages ? (
            <p className="text-sm text-muted-foreground">Consuming…</p>
          ) : messages == null ? null : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages within timeout.
            </p>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-auto max-h-[60vh]">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">P</th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Offset
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Time
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">Key</th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m, i) => (
                    <tr key={i} className="border-t border-border/30">
                      <td className="px-3 py-1.5 align-top">{m.partition}</td>
                      <td className="px-3 py-1.5 align-top">{m.offset}</td>
                      <td className="px-3 py-1.5 align-top text-muted-foreground">
                        {new Date(Number(m.timestamp)).toISOString()}
                      </td>
                      <td className="px-3 py-1.5 align-top max-w-[20ch] truncate">
                        {m.key ?? (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-top max-w-[60ch] whitespace-pre-wrap break-words">
                        {m.value ?? (
                          <span className="text-muted-foreground/50">null</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="produce" className="pt-4 space-y-3 max-w-2xl">
          <div className="space-y-2">
            <Label htmlFor="prod-key">Key (optional)</Label>
            <Input
              id="prod-key"
              value={prodKey}
              onChange={(e) => setProdKey(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prod-value">Value</Label>
            <Textarea
              id="prod-value"
              value={prodValue}
              onChange={(e) => setProdValue(e.target.value)}
              rows={6}
              className="font-mono text-xs"
              spellCheck={false}
            />
          </div>
          <Button onClick={produce} disabled={producing || !prodValue}>
            {producing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Produce
          </Button>
        </TabsContent>

        <TabsContent value="configs" className="pt-4">
          {detail ? (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.configs.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-mono text-xs">
                        {c.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs break-all">
                        {c.value}
                      </TableCell>
                      <TableCell>
                        {c.isDefault ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px]"
                          >
                            default
                          </Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  );
}
