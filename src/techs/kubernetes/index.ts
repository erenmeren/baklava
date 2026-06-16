// SERVER ONLY — imports driver code. Client code must import from ./meta or @/techs/meta-registry, never this file.
import type { TechModule } from "@/techs/contract";
import type { KubernetesConfig } from "@/lib/connections/types";
import { probe as probeKubernetes, dropKubernetesClient } from "@/lib/connections/kubernetes";
import { kubernetesMeta } from "./meta";

export const kubernetes: TechModule<KubernetesConfig> = {
  ...kubernetesMeta,
  driver: {
    probe: async (c: KubernetesConfig) => {
      const id = `__probe_${Math.random().toString(36).slice(2)}`;
      try {
        return await probeKubernetes(id, c);
      } finally {
        dropKubernetesClient(id);
      }
    },
  },
};
