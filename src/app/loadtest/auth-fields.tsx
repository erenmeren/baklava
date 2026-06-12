"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import type { AuthForm, HeaderRow } from "./form-serialize";

export function HeaderRows({
  rows,
  onChange,
  secret = false,
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  secret?: boolean;
}) {
  const set = (i: number, patch: Partial<HeaderRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input value={r.key} onChange={(e) => set(i, { key: e.target.value })} placeholder="Header" className="flex-1" />
          <Input
            value={r.value}
            onChange={(e) => set(i, { value: e.target.value })}
            placeholder={secret ? "(unchanged — leave blank to keep)" : "value"}
            type={secret ? "password" : "text"}
            className="flex-1"
          />
          <Button type="button" size="icon" variant="ghost" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} aria-label="Remove header">
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, { key: "", value: "" }])}>
        <Plus className="size-3.5" />
        Add header
      </Button>
    </div>
  );
}

const AUTH_TYPES = ["none", "bearer", "basic", "apiKey", "customHeaders"] as const;

export function AuthFields({
  auth,
  editing,
  onChange,
}: {
  auth: AuthForm;
  editing: boolean;
  onChange: (auth: AuthForm) => void;
}) {
  const placeholder = editing ? "(unchanged — leave blank to keep)" : undefined;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Auth</Label>
        <Select
          value={auth.type}
          onValueChange={(v) => {
            const t = v as AuthForm["type"];
            if (t === "none") onChange({ type: "none" });
            else if (t === "bearer") onChange({ type: "bearer", token: "" });
            else if (t === "basic") onChange({ type: "basic", username: "", password: "" });
            else if (t === "apiKey") onChange({ type: "apiKey", header: "", value: "" });
            else onChange({ type: "customHeaders", headers: [] });
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {AUTH_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {auth.type === "bearer" ? (
        <div className="space-y-1">
          <Label>Token</Label>
          <Input type="password" value={auth.token} placeholder={placeholder} onChange={(e) => onChange({ ...auth, token: e.target.value })} />
        </div>
      ) : null}

      {auth.type === "basic" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Username</Label>
            <Input value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Password</Label>
            <Input type="password" value={auth.password} placeholder={placeholder} onChange={(e) => onChange({ ...auth, password: e.target.value })} />
          </div>
        </div>
      ) : null}

      {auth.type === "apiKey" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Header</Label>
            <Input value={auth.header} onChange={(e) => onChange({ ...auth, header: e.target.value })} placeholder="X-Api-Key" />
          </div>
          <div className="space-y-1">
            <Label>Value</Label>
            <Input type="password" value={auth.value} placeholder={placeholder} onChange={(e) => onChange({ ...auth, value: e.target.value })} />
          </div>
        </div>
      ) : null}

      {auth.type === "customHeaders" ? (
        <div className="space-y-1">
          <Label>Custom auth headers</Label>
          <HeaderRows rows={auth.headers} secret={editing} onChange={(headers) => onChange({ ...auth, headers })} />
        </div>
      ) : null}
    </div>
  );
}
