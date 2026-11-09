import { describe, it, expect } from "vitest";
import {
  hpaMetricsSummary,
  mapHpa,
  mapLimitRange,
  mapNetworkPolicy,
  mapPdb,
  mapPv,
  mapReplicaSet,
  mapResourceQuota,
  mapRole,
  mapRoleBinding,
  mapServiceAccount,
  mapStorageClass,
  rulesSummary,
} from "./resource-mappers";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const AN_HOUR_AGO = "2026-08-18T11:00:00.000Z";
const meta = { name: "api", namespace: "payments", creationTimestamp: AN_HOUR_AGO };
const clusterMeta = { name: "api", creationTimestamp: AN_HOUR_AGO };

describe("mapHpa", () => {
  const hpa = {
    metadata: meta,
    spec: {
      scaleTargetRef: { kind: "Deployment", name: "api" },
      minReplicas: 2,
      maxReplicas: 10,
      metrics: [
        { type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 80 } } },
        { type: "Resource", resource: { name: "memory", target: { type: "AverageValue", averageValue: "256Mi" } } },
      ],
    },
    status: {
      currentReplicas: 3,
      desiredReplicas: 4,
      currentMetrics: [
        { type: "Resource", resource: { name: "cpu", current: { averageUtilization: 45 } } },
      ],
    },
  };

  it("renders reference, bounds and replica counts", () => {
    expect(mapHpa(hpa, NOW)).toMatchObject({
      namespace: "payments",
      name: "api",
      target: "Deployment/api",
      minReplicas: 2,
      maxReplicas: 10,
      current: 3,
      desired: 4,
      ageSeconds: 3600,
    });
  });

  it("summarizes metrics like kubectl's TARGETS, unknown until reported", () => {
    expect(mapHpa(hpa, NOW).metrics).toBe("cpu 45%/80%, memory <unknown>/256Mi");
  });

  it("covers pods/external metrics and defaults minReplicas to 1", () => {
    expect(
      hpaMetricsSummary(
        [{ type: "External", external: { metric: { name: "queue" }, target: { type: "Value", value: "30" } } }],
        [{ type: "External", external: { metric: { name: "queue" }, current: { value: "12" } } }],
      ),
    ).toBe("queue 12/30");
    expect(mapHpa({ metadata: meta, spec: {} }, NOW)).toMatchObject({ minReplicas: 1, metrics: "—" });
  });
});

describe("mapReplicaSet", () => {
  it("names the controlling owner and lists images", () => {
    const row = mapReplicaSet(
      {
        metadata: { ...meta, ownerReferences: [{ kind: "Deployment", name: "api", controller: true }] },
        spec: { replicas: 3, template: { spec: { containers: [{ image: "a:1" }, { image: "b:2" }] } } },
        status: { replicas: 3, readyReplicas: 2 },
      },
      NOW,
    );
    expect(row).toEqual({
      namespace: "payments",
      name: "api",
      owner: "Deployment/api",
      desired: 3,
      current: 3,
      ready: 2,
      images: "a:1,b:2",
      ageSeconds: 3600,
    });
  });

  it("dashes an orphan and zeroes missing status", () => {
    expect(mapReplicaSet({ metadata: meta }, NOW)).toMatchObject({ owner: "—", desired: 0, ready: 0, images: "—" });
  });
});

describe("access kinds", () => {
  it("counts a ServiceAccount's secret references without resolving them", () => {
    expect(mapServiceAccount({ metadata: meta, secrets: [{ name: "tok" }] }, NOW).secrets).toBe(1);
    expect(mapServiceAccount({ metadata: meta }, NOW).secrets).toBe(0);
  });

  it("summarizes role rules compactly", () => {
    const rules = [
      { verbs: ["get", "list"], resources: ["pods", "services"] },
      { verbs: ["*"], resources: ["deployments"] },
      { verbs: ["get"], nonResourceURLs: ["/healthz"] },
    ];
    expect(rulesSummary(rules)).toBe("get,list pods,services; * deployments; get /healthz");
    expect(mapRole({ metadata: meta, rules }, NOW)).toMatchObject({ namespace: "payments", rules: 3 });
  });

  it("leaves namespace off a ClusterRole and copes with aggregated (null) rules", () => {
    const row = mapRole({ metadata: clusterMeta, rules: null }, NOW);
    expect(row).not.toHaveProperty("namespace");
    expect(row).toMatchObject({ rules: 0, summary: "—" });
  });

  it("renders a binding's roleRef and subjects", () => {
    const row = mapRoleBinding(
      {
        metadata: meta,
        roleRef: { kind: "ClusterRole", name: "view" },
        subjects: [
          { kind: "User", name: "alice" },
          { kind: "ServiceAccount", name: "default", namespace: "demo" },
        ],
      },
      NOW,
    );
    expect(row.role).toBe("ClusterRole/view");
    expect(row.subjects).toBe("User/alice, ServiceAccount/demo/default");
    expect(mapRoleBinding({ metadata: clusterMeta }, NOW)).toMatchObject({ role: "—", subjects: "—" });
  });
});

describe("mapNetworkPolicy", () => {
  it("shows selector, types and rule counts", () => {
    expect(
      mapNetworkPolicy(
        {
          metadata: meta,
          spec: {
            podSelector: { matchLabels: { app: "api" } },
            policyTypes: ["Ingress", "Egress"],
            ingress: [{}, {}],
            egress: [{}],
          },
        },
        NOW,
      ),
    ).toMatchObject({ podSelector: "app=api", policyTypes: "Ingress,Egress", ingressRules: 2, egressRules: 1 });
  });

  it("an empty selector means every pod; unset types mean Ingress", () => {
    expect(mapNetworkPolicy({ metadata: meta, spec: { podSelector: {} } }, NOW)).toMatchObject({
      podSelector: "<all>",
      policyTypes: "Ingress",
      ingressRules: 0,
    });
  });
});

describe("storage kinds", () => {
  it("maps a bound PersistentVolume", () => {
    expect(
      mapPv(
        {
          metadata: clusterMeta,
          spec: {
            capacity: { storage: "1Gi" },
            accessModes: ["ReadWriteOnce"],
            persistentVolumeReclaimPolicy: "Delete",
            storageClassName: "local-path",
            claimRef: { namespace: "demo", name: "data" },
          },
          status: { phase: "Bound" },
        },
        NOW,
      ),
    ).toEqual({
      name: "api",
      capacity: "1Gi",
      accessModes: "RWO",
      reclaimPolicy: "Delete",
      status: "Bound",
      claim: "demo/data",
      storageClass: "local-path",
      ageSeconds: 3600,
    });
  });

  it("marks the default StorageClass and fills API defaults", () => {
    const row = mapStorageClass(
      {
        metadata: { ...clusterMeta, annotations: { "storageclass.kubernetes.io/is-default-class": "true" } },
        provisioner: "rancher.io/local-path",
        volumeBindingMode: "WaitForFirstConsumer",
      },
      NOW,
    );
    expect(row).toMatchObject({
      isDefault: true,
      provisioner: "rancher.io/local-path",
      reclaimPolicy: "Delete",
      bindingMode: "WaitForFirstConsumer",
      allowExpansion: false,
    });
    expect(mapStorageClass({ metadata: clusterMeta }, NOW).isDefault).toBe(false);
  });
});

describe("mapPdb", () => {
  it("renders either bound and the disruption budget", () => {
    expect(
      mapPdb(
        {
          metadata: meta,
          spec: { minAvailable: "50%" },
          status: { currentHealthy: 3, desiredHealthy: 2, disruptionsAllowed: 1 },
        },
        NOW,
      ),
    ).toMatchObject({ minAvailable: "50%", maxUnavailable: "N/A", currentHealthy: 3, desiredHealthy: 2, disruptionsAllowed: 1 });
    expect(mapPdb({ metadata: meta, spec: { maxUnavailable: 1 } }, NOW)).toMatchObject({
      minAvailable: "N/A",
      maxUnavailable: "1",
      disruptionsAllowed: 0,
    });
  });
});

describe("quota and limits", () => {
  it("renders used/hard per resource, sorted, zero when unused", () => {
    expect(
      mapResourceQuota(
        { metadata: meta, status: { hard: { pods: "10", "requests.cpu": "1" }, used: { pods: "3" } } },
        NOW,
      ).usage,
    ).toBe("pods 3/10, requests.cpu 0/1");
    expect(mapResourceQuota({ metadata: meta }, NOW).usage).toBe("—");
  });

  it("summarizes LimitRange items", () => {
    expect(
      mapLimitRange(
        {
          metadata: meta,
          spec: {
            limits: [
              { type: "Container", default: { cpu: "500m" }, defaultRequest: { cpu: "100m", memory: "64Mi" } },
              { type: "PersistentVolumeClaim", max: { storage: "10Gi" } },
            ],
          },
        },
        NOW,
      ).limits,
    ).toBe("Container default cpu=500m defaultRequest cpu=100m,memory=64Mi; PersistentVolumeClaim max storage=10Gi");
  });
});
