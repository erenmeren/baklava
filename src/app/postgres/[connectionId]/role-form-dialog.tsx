"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface RoleFormSeed {
  name: string;
  canLogin: boolean;
  isSuperuser: boolean;
  canCreateDb: boolean;
  canCreateRole: boolean;
  canReplication: boolean;
  inherits: boolean;
  connectionLimit: number;
}

interface BaseProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  onSuccess: () => void;
}

interface CreateProps extends BaseProps {
  mode: "create";
  initial?: never;
}

interface EditProps extends BaseProps {
  mode: "edit";
  initial: RoleFormSeed;
}

type Props = CreateProps | EditProps;

const ATTR_KEYS = [
  ["canLogin", "Login", "Allow this role to authenticate"],
  ["isSuperuser", "Superuser", "Bypass all permission checks"],
  ["canCreateDb", "Create DB", "May run CREATE DATABASE"],
  ["canCreateRole", "Create roles", "May create, alter, drop other roles"],
  ["canReplication", "Replication", "May initiate replication"],
  ["inherits", "Inherit", "Inherit privileges of parent roles"],
] as const;

const DEFAULT_SEED: RoleFormSeed = {
  name: "",
  canLogin: true,
  isSuperuser: false,
  canCreateDb: false,
  canCreateRole: false,
  canReplication: false,
  inherits: true,
  connectionLimit: -1,
};

export function RoleFormDialog(props: Props) {
  const { open, onOpenChange, connectionId, onSuccess, mode } = props;
  const initial = mode === "edit" ? props.initial : DEFAULT_SEED;

  const [form, setForm] = useState<RoleFormSeed>(initial);
  const [password, setPassword] = useState("");
  const [setNoPassword, setSetNoPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial);
      setPassword("");
      setSetNoPassword(false);
    }
  }, [open, initial]);

  const update = <K extends keyof RoleFormSeed>(
    key: K,
    value: RoleFormSeed[K],
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const submit = async () => {
    if (mode === "create" && !form.name.trim()) {
      toast.error("Role name is required");
      return;
    }
    setSubmitting(true);
    try {
      const attrs: Record<string, unknown> = {
        canLogin: form.canLogin,
        isSuperuser: form.isSuperuser,
        canCreateDb: form.canCreateDb,
        canCreateRole: form.canCreateRole,
        canReplication: form.canReplication,
        inherits: form.inherits,
        connectionLimit: form.connectionLimit,
      };
      if (mode === "create") {
        if (password) attrs.password = password;
      } else if (setNoPassword) {
        attrs.password = null;
      } else if (password) {
        attrs.password = password;
      }

      let res: Response;
      if (mode === "create") {
        res = await fetch(`/api/postgres/${connectionId}/roles`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: form.name.trim(), attrs }),
        });
      } else {
        res = await fetch(
          `/api/postgres/${connectionId}/roles/${encodeURIComponent(initial.name)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ attrs }),
          },
        );
      }
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          mode === "create"
            ? "Could not create role"
            : "Could not update role",
          { description: data.error },
        );
        return;
      }
      toast.success(
        mode === "create"
          ? `Role “${form.name.trim()}” created`
          : `Role “${initial.name}” updated`,
      );
      onSuccess();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New role" : `Edit role “${initial.name}”`}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Roles in PostgreSQL are accounts that can own database objects and connect."
              : "Adjust the attributes of this role. Leave the password blank to keep it unchanged."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          {mode === "create" ? (
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                autoFocus
                placeholder="e.g. analytics_reader"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                disabled={submitting}
                spellCheck={false}
                className="font-mono"
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-border/60 p-3">
            {ATTR_KEYS.map(([key, label, hint]) => (
              <div
                key={key}
                className={cn(
                  "flex items-start gap-2.5 rounded px-1.5 py-1 hover:bg-muted/40",
                )}
              >
                <Switch
                  id={`role-priv-${key}`}
                  size="sm"
                  checked={form[key] as boolean}
                  onCheckedChange={(v) =>
                    update(key, v as RoleFormSeed[typeof key])
                  }
                  disabled={submitting}
                  className="mt-0.5"
                />
                <Label
                  htmlFor={`role-priv-${key}`}
                  className="min-w-0 cursor-pointer block font-normal"
                >
                  <span className="block text-[12.5px] font-medium leading-tight">
                    {label}
                  </span>
                  <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5">
                    {hint}
                  </span>
                </Label>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="role-conn-limit">Connection limit</Label>
              <Input
                id="role-conn-limit"
                type="number"
                value={form.connectionLimit}
                onChange={(e) =>
                  update("connectionLimit", Number(e.target.value))
                }
                disabled={submitting}
                className="font-mono"
              />
              <p className="text-[10.5px] text-muted-foreground">
                -1 means unlimited.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-password">
                Password{" "}
                <span className="text-muted-foreground font-normal text-[11px]">
                  {mode === "create" ? "(optional)" : "(blank to keep)"}
                </span>
              </Label>
              <Input
                id="role-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting || setNoPassword}
                spellCheck={false}
                className="font-mono"
                placeholder={mode === "edit" ? "unchanged" : ""}
              />
              {mode === "edit" ? (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Switch
                    id="role-no-password"
                    size="sm"
                    checked={setNoPassword}
                    onCheckedChange={setSetNoPassword}
                    disabled={submitting}
                  />
                  <Label
                    htmlFor="role-no-password"
                    className="cursor-pointer text-[11px] font-normal text-muted-foreground"
                  >
                    remove password (PASSWORD NULL)
                  </Label>
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || (mode === "create" && !form.name.trim())}
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
