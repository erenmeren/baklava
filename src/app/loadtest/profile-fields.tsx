"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProfileForm } from "./form-serialize";

const PROFILE_TYPES = ["constant", "ramping", "constantRate", "rampingRate", "baseline", "breakpoint"] as const;

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function ProfileFields({ profile, onChange }: { profile: ProfileForm; onChange: (p: ProfileForm) => void }) {
  const set = (patch: object) => onChange({ ...profile, ...patch } as ProfileForm);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Load profile</Label>
        <Select
          value={profile.type}
          onValueChange={(v) => {
            const t = v as ProfileForm["type"];
            if (t === "constant") onChange({ type: "constant", vus: "5", duration: "30s" });
            else if (t === "ramping") onChange({ type: "ramping", startVUs: "0", stages: [{ target: "20", duration: "30s" }] });
            else if (t === "constantRate") onChange({ type: "constantRate", rate: "50", duration: "1m", preAllocatedVUs: "50" });
            else if (t === "rampingRate") onChange({ type: "rampingRate", startRate: "0", preAllocatedVUs: "100", stages: [{ target: "200", duration: "2m" }] });
            else if (t === "baseline") onChange({ type: "baseline", rate: "50", duration: "1m", preAllocatedVUs: "50" });
            else onChange({ type: "breakpoint", maxRate: "500", duration: "2m", preAllocatedVUs: "200" });
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROFILE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {profile.type === "constant" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="VUs" value={profile.vus} onChange={(v) => set({ vus: v })} />
          <Field label="Duration" value={profile.duration} onChange={(v) => set({ duration: v })} placeholder="30s" />
        </div>
      ) : null}

      {profile.type === "baseline" ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Rate (rps)" value={profile.rate} onChange={(v) => set({ rate: v })} />
          <Field label="Duration" value={profile.duration} onChange={(v) => set({ duration: v })} />
          <Field label="Pre-alloc VUs" value={profile.preAllocatedVUs} onChange={(v) => set({ preAllocatedVUs: v })} />
        </div>
      ) : null}

      {profile.type === "breakpoint" ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Max rate (rps)" value={profile.maxRate} onChange={(v) => set({ maxRate: v })} />
          <Field label="Duration" value={profile.duration} onChange={(v) => set({ duration: v })} />
          <Field label="Pre-alloc VUs" value={profile.preAllocatedVUs} onChange={(v) => set({ preAllocatedVUs: v })} />
        </div>
      ) : null}

      {profile.type === "constantRate" ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Rate (rps)" value={profile.rate} onChange={(v) => set({ rate: v })} />
          <Field label="Duration" value={profile.duration} onChange={(v) => set({ duration: v })} />
          <Field label="Pre-alloc VUs" value={profile.preAllocatedVUs} onChange={(v) => set({ preAllocatedVUs: v })} />
        </div>
      ) : null}

      {profile.type === "ramping" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start VUs" value={profile.startVUs} onChange={(v) => set({ startVUs: v })} />
          <Field label="Stage target / duration" value={profile.stages[0]?.target ?? ""} onChange={(v) => set({ stages: [{ target: v, duration: profile.stages[0]?.duration ?? "30s" }] })} placeholder="20" />
        </div>
      ) : null}

      {profile.type === "rampingRate" ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start rate" value={profile.startRate} onChange={(v) => set({ startRate: v })} />
          <Field label="Pre-alloc VUs" value={profile.preAllocatedVUs} onChange={(v) => set({ preAllocatedVUs: v })} />
          <Field label="Stage target" value={profile.stages[0]?.target ?? ""} onChange={(v) => set({ stages: [{ target: v, duration: profile.stages[0]?.duration ?? "2m" }] })} />
        </div>
      ) : null}
    </div>
  );
}
