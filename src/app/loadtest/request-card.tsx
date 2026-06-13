"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HeaderRow, HttpMethod, RequestForm } from "./form-serialize";
import { HeaderRows } from "./auth-fields";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: "text-emerald-600 dark:text-emerald-400",
  POST: "text-blue-600 dark:text-blue-400",
  PUT: "text-amber-600 dark:text-amber-400",
  PATCH: "text-violet-600 dark:text-violet-400",
  DELETE: "text-destructive",
  HEAD: "text-muted-foreground",
  OPTIONS: "text-muted-foreground",
};

const BODYLESS = new Set<HttpMethod>(["GET", "HEAD"]);

export function RequestCard({
  req,
  index,
  expanded,
  onToggle,
  onChange,
  onRemove,
  onMove,
  canRemove,
}: {
  req: RequestForm;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<RequestForm>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canRemove: boolean;
}) {
  const bodyless = BODYLESS.has(req.method);
  const [tab, setTab] = useState("headers");

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? "Collapse request" : "Expand request"}
          className="text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        <Select value={req.method} onValueChange={(v) => onChange({ method: v as HttpMethod })}>
          <SelectTrigger
            className={cn("w-[108px] font-mono text-xs font-semibold", METHOD_COLOR[req.method])}
            aria-label="HTTP method"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m} className={cn("font-mono font-semibold", METHOD_COLOR[m])}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={req.path}
          onChange={(e) => onChange({ path: e.target.value })}
          placeholder="/api/items"
          aria-label="Request path"
          className="flex-1 font-mono text-xs"
        />

        <Input
          value={req.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={`request ${index + 1}`}
          aria-label="Request name"
          className="w-40 text-xs hidden md:block"
        />

        <Button type="button" size="icon" variant="ghost" onClick={() => onMove(-1)} aria-label="Move up">
          <ArrowUp className="size-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={() => onMove(1)} aria-label="Move down">
          <ArrowDown className="size-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={onRemove} disabled={!canRemove} aria-label="Remove">
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3">
          <Input
            value={req.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={`request ${index + 1}`}
            aria-label="Request name (mobile)"
            className="text-xs md:hidden"
          />

          <Tabs value={bodyless && tab === "body" ? "headers" : tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="headers">Headers</TabsTrigger>
              <TabsTrigger value="body" disabled={bodyless}>Body</TabsTrigger>
              <TabsTrigger value="checks">Checks</TabsTrigger>
            </TabsList>

            <TabsContent value="headers" className="pt-3">
              <HeaderRows rows={req.headers} onChange={(headers: HeaderRow[]) => onChange({ headers })} />
            </TabsContent>

            <TabsContent value="body" className="pt-3">
              <Textarea
                value={req.body}
                onChange={(e) => onChange({ body: e.target.value })}
                rows={5}
                placeholder='{"key":"value"}'
                className="font-mono text-xs"
              />
            </TabsContent>

            <TabsContent value="checks" className="pt-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Check status</Label>
                  <Input value={req.checkStatus} onChange={(e) => onChange({ checkStatus: e.target.value })} placeholder="200" />
                </div>
                <div className="space-y-1">
                  <Label>Body contains</Label>
                  <Input value={req.checkBodyContains} onChange={(e) => onChange({ checkBodyContains: e.target.value })} placeholder="ok" />
                </div>
                <div className="space-y-1">
                  <Label>Think time (s)</Label>
                  <Input value={req.thinkTime} onChange={(e) => onChange({ thinkTime: e.target.value })} placeholder="0" />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {bodyless ? (
            <p className="text-xs text-muted-foreground">{req.method} requests usually have no body.</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
