// SERVER ONLY — imports driver code. Client code must import from ./meta or @/techs/meta-registry, never this file.
import type { TechModule } from "@/techs/contract";
import type { MongoConfig } from "@/lib/connections/types";
import { probe as probeMongo, dropMongoClient } from "@/lib/connections/mongo";
import { mongoBody } from "@/lib/connections/health";
import { mongoMeta } from "./meta";

export const mongo: TechModule<MongoConfig> = {
  ...mongoMeta,
  driver: {
    probe: async (c: MongoConfig) => {
      const id = `__probe_${Math.random().toString(36).slice(2)}`;
      try {
        return await probeMongo(id, c);
      } finally {
        dropMongoClient(id);
      }
    },
    health: mongoBody,
  },
};
