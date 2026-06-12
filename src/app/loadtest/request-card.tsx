"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import type { HeaderRow, HttpMethod, RequestForm } from "./form-serialize";
import { HeaderRows } from "./auth-fields";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

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
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToggle} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <span className="font-mono text-xs font-medium">{req.method}</span>
        <span className="font-mono text-xs text-muted-foreground truncate flex-1">{req.path || "/"}</span>
        <span className="text-xs text-muted-foreground truncate">{req.name || `request ${index + 1}`}</span>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={req.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="list items" />
            </div>
            <div className="space-y-1">
              <Label>Method</Label>
              <Select value={req.method} onValueChange={(v) => onChange({ method: v as HttpMethod })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Path</Label>
            <Input value={req.path} onChange={(e) => onChange({ path: e.target.value })} placeholder="/api/items" />
          </div>
          <div className="space-y-1">
            <Label>Headers</Label>
            <HeaderRows rows={req.headers} onChange={(headers: HeaderRow[]) => onChange({ headers })} />
          </div>
          <div className="space-y-1">
            <Label>Body</Label>
            <Textarea value={req.body} onChange={(e) => onChange({ body: e.target.value })} rows={3} placeholder='{"key":"value"}' />
          </div>
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
        </div>
      ) : null}
    </Card>
  );
}
