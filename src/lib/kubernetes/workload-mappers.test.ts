import { describe, it, expect } from "vitest";
import {
  mapCronJob,
  mapDaemonSet,
  mapIngress,
  mapJob,
  mapPvc,
  mapStatefulSet,
} from "./workload-mappers";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const AN_HOUR_AGO = "2026-08-18T11:00:00.000Z";
const meta = { name: "api", namespace: "payments", creationTimestamp: AN_HOUR_AGO };

describe("mapStatefulSet", () => {
  const sts = {
    metadata: meta,
    spec: {
      replicas: 3,
      serviceName: "api-headless",
      template: { spec: { containers: [{ image: "ghcr.io/acme/api:1.0" }] } },
    },
    status: { readyReplicas: 2 },
  };

  it("renders ready as ready/desired", () => {
    expect(mapStatefulSet(sts, NOW).ready).toBe("2/3");
  });

  it("treats a missing readyReplicas as zero, not blank", () => {
    expect(mapStatefulSet({ ...sts, status: {} }, NOW).ready).toBe("0/3");
  });

  it("carries the governing service and first container image", () => {
    const row = mapStatefulSet(sts, NOW);
    expect(row.service).toBe("api-headless");
    expect(row.image).toBe("ghcr.io/acme/api:1.0");
  });
});

describe("mapDaemonSet", () => {
  const ds = {
    metadata: meta,
    spec: { template: { spec: { containers: [{ image: "fluentbit:2" }] } } },
    status: {
      desiredNumberScheduled: 4,
      currentNumberScheduled: 4,
      numberReady: 3,
      numberAvailable: 3,
      updatedNumberScheduled: 4,
    },
  };

  it("reports desired / current / ready straight off the status", () => {
    const row = mapDaemonSet(ds, NOW);
    expect(row.desired).toBe(4);
    expect(row.current).toBe(4);
    expect(row.ready).toBe(3);
    expect(row.upToDate).toBe(4);
    expect(row.available).toBe(3);
  });

  it("defaults every counter to zero on a freshly created daemonset", () => {
    const row = mapDaemonSet({ metadata: meta, status: {} }, NOW);
    expect(row.desired).toBe(0);
    expect(row.ready).toBe(0);
  });
});

describe("mapJob", () => {
  const job = {
    metadata: meta,
    spec: { completions: 3, template: { spec: { containers: [{ image: "migrate:1" }] } } },
    status: { succeeded: 3, failed: 0, startTime: "2026-08-18T11:00:00.000Z", completionTime: "2026-08-18T11:05:00.000Z" },
  };

  it("renders completions as succeeded/desired", () => {
    expect(mapJob(job, NOW).completions).toBe("3/3");
  });

  it("is Complete once the desired completions succeeded", () => {
    expect(mapJob(job, NOW).status).toBe("Complete");
  });

  it("is Failed when any pod failed and none are still going", () => {
    const failed = { ...job, status: { succeeded: 0, failed: 2, startTime: job.status.startTime } };
    expect(mapJob(failed, NOW).status).toBe("Failed");
  });

  it("is Running while it has started but not finished", () => {
    const running = { ...job, status: { succeeded: 1, startTime: job.status.startTime } };
    expect(mapJob(running, NOW).status).toBe("Running");
  });

  it("reports the duration between start and completion", () => {
    expect(mapJob(job, NOW).duration).toBe("5m");
  });

  it("measures an unfinished job against now", () => {
    const running = { ...job, status: { succeeded: 0, startTime: "2026-08-18T11:58:00.000Z" } };
    expect(mapJob(running, NOW).duration).toBe("2m");
  });

  it("shows no duration for a job that never started", () => {
    expect(mapJob({ metadata: meta, spec: {}, status: {} }, NOW).duration).toBe("—");
  });
});

describe("mapCronJob", () => {
  const cron = {
    metadata: meta,
    spec: {
      schedule: "*/5 * * * *",
      suspend: false,
      jobTemplate: { spec: { template: { spec: { containers: [{ image: "report:3" }] } } } },
    },
    status: { active: [{ name: "api-123" }], lastScheduleTime: "2026-08-18T11:55:00.000Z" },
  };

  it("carries the schedule and suspension state", () => {
    const row = mapCronJob(cron, NOW);
    expect(row.schedule).toBe("*/5 * * * *");
    expect(row.suspend).toBe(false);
  });

  it("counts active jobs", () => {
    expect(mapCronJob(cron, NOW).active).toBe(1);
    expect(mapCronJob({ ...cron, status: {} }, NOW).active).toBe(0);
  });

  it("ages the last schedule separately from the object itself", () => {
    const row = mapCronJob(cron, NOW);
    expect(row.lastScheduleSeconds).toBe(300);
    expect(row.ageSeconds).toBe(3600);
  });

  it("reports a never-scheduled cronjob as null, not zero", () => {
    expect(mapCronJob({ ...cron, status: {} }, NOW).lastScheduleSeconds).toBeNull();
  });

  it("reaches through jobTemplate for the image", () => {
    expect(mapCronJob(cron, NOW).image).toBe("report:3");
  });
});

describe("mapIngress", () => {
  const ing = {
    metadata: meta,
    spec: {
      ingressClassName: "nginx",
      rules: [
        { host: "acme.io", http: { paths: [{ path: "/" }, { path: "/api" }] } },
        { host: "www.acme.io", http: { paths: [{ path: "/" }] } },
      ],
    },
    status: { loadBalancer: { ingress: [{ ip: "203.0.113.9" }] } },
  };

  it("joins the hosts and paths", () => {
    const row = mapIngress(ing, NOW);
    expect(row.hosts).toBe("acme.io,www.acme.io");
    expect(row.paths).toBe("/,/api,/");
  });

  it("takes the load balancer address, ip or hostname", () => {
    expect(mapIngress(ing, NOW).address).toBe("203.0.113.9");
    const byName = {
      ...ing,
      status: { loadBalancer: { ingress: [{ hostname: "lb.acme.io" }] } },
    };
    expect(mapIngress(byName, NOW).address).toBe("lb.acme.io");
  });

  it("shows a dash while no address has been assigned", () => {
    expect(mapIngress({ ...ing, status: {} }, NOW).address).toBe("—");
  });

  it("carries the ingress class", () => {
    expect(mapIngress(ing, NOW).className).toBe("nginx");
    expect(mapIngress({ ...ing, spec: { rules: [] } }, NOW).className).toBe("<none>");
  });
});

describe("mapPvc", () => {
  const pvc = {
    metadata: meta,
    spec: { storageClassName: "fast", accessModes: ["ReadWriteOnce"], volumeName: "pv-1" },
    status: { phase: "Bound", capacity: { storage: "10Gi" } },
  };

  it("reports the phase, volume and capacity", () => {
    const row = mapPvc(pvc, NOW);
    expect(row.status).toBe("Bound");
    expect(row.volume).toBe("pv-1");
    expect(row.capacity).toBe("10 GiB");
  });

  it("abbreviates access modes the way kubectl does", () => {
    expect(mapPvc(pvc, NOW).accessModes).toBe("RWO");
    const many = { ...pvc, spec: { ...pvc.spec, accessModes: ["ReadWriteMany", "ReadOnlyMany"] } };
    expect(mapPvc(many, NOW).accessModes).toBe("RWX,ROX");
  });

  it("falls back to the requested size while still Pending", () => {
    const pending = {
      metadata: meta,
      spec: { resources: { requests: { storage: "5Gi" } } },
      status: { phase: "Pending" },
    };
    const row = mapPvc(pending, NOW);
    expect(row.status).toBe("Pending");
    expect(row.capacity).toBe("5 GiB");
  });
});
