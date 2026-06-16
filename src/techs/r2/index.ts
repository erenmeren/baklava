// SERVER ONLY — imports driver code. Client code must import from ./meta or @/techs/meta-registry, never this file.
import type { TechModule } from "@/techs/contract";
import type { R2Config } from "@/lib/connections/types";
import { r2ClientFor, dropR2Client } from "@/lib/connections/r2";
import { probe as s3Probe } from "@/lib/connections/s3";
import { r2Meta } from "./meta";

export const r2: TechModule<R2Config> = {
  ...r2Meta,
  driver: {
    probe: async (c: R2Config) => {
      const id = `__probe_${Math.random().toString(36).slice(2)}`;
      const client = r2ClientFor(id, c);
      try {
        return await s3Probe(client);
      } finally {
        dropR2Client(id);
      }
    },
  },
};
