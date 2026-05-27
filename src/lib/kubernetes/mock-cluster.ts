/**
 * Mock cluster state used by the k8s workspace while the driver is stubbed
 * out. Deterministic and exported as a pure data structure so the UI can
 * render server-side. Ages are stored as offsets-from-now (ms) and rendered
 * relatively on the client.
 *
 * Status / Ready / Restart values are picked to exercise every visual state:
 * Running / Pending / CrashLoopBackOff / Completed / Error / Terminating.
 */

export type PodPhase =
  | "Running"
  | "Pending"
  | "Succeeded"
  | "Failed"
  | "Unknown"
  | "Terminating"
  | "CrashLoopBackOff"
  | "ImagePullBackOff"
  | "ContainerCreating"
  | "Init"
  | "Completed"
  | "Error";

export interface PodRow {
  namespace: string;
  name: string;
  ready: string; // "1/1", "0/2"
  status: PodPhase;
  restarts: number;
  lastRestart?: string; // human "3m ago"
  ip: string;
  node: string;
  ageSeconds: number;
  cpu: string; // "12m"
  mem: string; // "84Mi"
  qos: "Guaranteed" | "Burstable" | "BestEffort";
}

export interface DeploymentRow {
  namespace: string;
  name: string;
  ready: string; // "3/3"
  upToDate: number;
  available: number;
  ageSeconds: number;
  image: string;
  selector: string;
}

export interface ServiceRow {
  namespace: string;
  name: string;
  type: "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName" | "Headless";
  clusterIP: string;
  externalIP: string;
  ports: string;
  ageSeconds: number;
  selector: string;
}

export interface ConfigMapRow {
  namespace: string;
  name: string;
  dataKeys: number;
  ageSeconds: number;
  labels: string;
}

export interface SecretRow {
  namespace: string;
  name: string;
  type:
    | "Opaque"
    | "kubernetes.io/dockerconfigjson"
    | "kubernetes.io/tls"
    | "kubernetes.io/service-account-token";
  dataKeys: number;
  ageSeconds: number;
}

export interface NamespaceRow {
  name: string;
  status: "Active" | "Terminating";
  ageSeconds: number;
  pods: number;
  labels: string;
}

export interface MockCluster {
  context: string;
  serverVersion: string;
  nodes: { name: string; ready: boolean; role: string; version: string }[];
  namespaces: NamespaceRow[];
  pods: PodRow[];
  deployments: DeploymentRow[];
  services: ServiceRow[];
  configMaps: ConfigMapRow[];
  secrets: SecretRow[];
}

const NS = ["default", "kube-system", "monitoring", "payments", "platform"];

const NODES = [
  { name: "ip-10-0-1-12.eu-west-1.compute.internal", role: "control-plane" },
  { name: "ip-10-0-2-44.eu-west-1.compute.internal", role: "worker" },
  { name: "ip-10-0-3-87.eu-west-1.compute.internal", role: "worker" },
];

function n(name: string, ns: string) {
  return { name, namespace: ns };
}

/**
 * Single shared cluster instance. Ages are *seconds since some fixed start*;
 * they don't drift while the page is open, which keeps the table stable.
 */
export function buildMockCluster(): MockCluster {
  const pods: PodRow[] = [
    // payments
    {
      ...n("api-gateway-7d4f9c5b6c-9xk2p", "payments"),
      ready: "1/1",
      status: "Running",
      restarts: 0,
      ip: "10.244.2.11",
      node: NODES[1].name,
      ageSeconds: 60 * 60 * 78,
      cpu: "47m",
      mem: "212Mi",
      qos: "Burstable",
    },
    {
      ...n("api-gateway-7d4f9c5b6c-bz4lm", "payments"),
      ready: "1/1",
      status: "Running",
      restarts: 1,
      lastRestart: "2h ago",
      ip: "10.244.3.18",
      node: NODES[2].name,
      ageSeconds: 60 * 60 * 78,
      cpu: "52m",
      mem: "234Mi",
      qos: "Burstable",
    },
    {
      ...n("settlement-worker-bcd-zz1qq", "payments"),
      ready: "0/1",
      status: "CrashLoopBackOff",
      restarts: 17,
      lastRestart: "32s ago",
      ip: "10.244.2.44",
      node: NODES[1].name,
      ageSeconds: 60 * 36,
      cpu: "0m",
      mem: "8Mi",
      qos: "BestEffort",
    },
    {
      ...n("ledger-migration-2k4n7", "payments"),
      ready: "0/1",
      status: "Completed",
      restarts: 0,
      ip: "10.244.3.51",
      node: NODES[2].name,
      ageSeconds: 60 * 60 * 12,
      cpu: "0m",
      mem: "0Mi",
      qos: "Burstable",
    },
    {
      ...n("fraud-scorer-canary-aaa11", "payments"),
      ready: "1/1",
      status: "Running",
      restarts: 0,
      ip: "10.244.2.77",
      node: NODES[1].name,
      ageSeconds: 60 * 14,
      cpu: "118m",
      mem: "412Mi",
      qos: "Guaranteed",
    },
    // platform
    {
      ...n("ingress-nginx-controller-x9w2j", "platform"),
      ready: "1/1",
      status: "Running",
      restarts: 3,
      lastRestart: "1d ago",
      ip: "10.244.1.4",
      node: NODES[0].name,
      ageSeconds: 60 * 60 * 24 * 14,
      cpu: "21m",
      mem: "180Mi",
      qos: "Burstable",
    },
    {
      ...n("cert-manager-7bb59dc8c9-jkpqz", "platform"),
      ready: "1/1",
      status: "Running",
      restarts: 0,
      ip: "10.244.1.9",
      node: NODES[0].name,
      ageSeconds: 60 * 60 * 24 * 14,
      cpu: "4m",
      mem: "48Mi",
      qos: "BestEffort",
    },
    {
      ...n("vault-agent-injector-2lkqp", "platform"),
      ready: "0/1",
      status: "ImagePullBackOff",
      restarts: 0,
      ip: "",
      node: NODES[2].name,
      ageSeconds: 60 * 4,
      cpu: "0m",
      mem: "0Mi",
      qos: "BestEffort",
    },
    {
      ...n("argocd-server-5d77c79b6-mn8pq", "platform"),
      ready: "1/1",
      status: "Running",
      restarts: 0,
      ip: "10.244.3.92",
      node: NODES[2].name,
      ageSeconds: 60 * 60 * 24 * 7,
      cpu: "14m",
      mem: "152Mi",
      qos: "Burstable",
    },
    // monitoring
    {
      ...n("prometheus-server-0", "monitoring"),
      ready: "2/2",
      status: "Running",
      restarts: 1,
      lastRestart: "4d ago",
      ip: "10.244.2.30",
      node: NODES[1].name,
      ageSeconds: 60 * 60 * 24 * 30,
      cpu: "187m",
      mem: "1.2Gi",
      qos: "Guaranteed",
    },
    {
      ...n("grafana-7d97c79b65-2jmkx", "monitoring"),
      ready: "1/1",
      status: "Running",
      restarts: 0,
      ip: "10.244.1.41",
      node: NODES[0].name,
      ageSeconds: 60 * 60 * 24 * 30,
      cpu: "8m",
      mem: "112Mi",
      qos: "Burstable",
    },
    {
      ...n("loki-0", "monitoring"),
      ready: "1/1",
      status: "Running",
      restarts: 0,
      ip: "10.244.2.62",
      node: NODES[1].name,
      ageSeconds: 60 * 60 * 24 * 21,
      cpu: "31m",
      mem: "478Mi",
      qos: "Burstable",
    },
    {
      ...n("alertmanager-0", "monitoring"),
      ready: "0/1",
      status: "Pending",
      restarts: 0,
      ip: "",
      node: "<unscheduled>",
      ageSeconds: 60 * 8,
      cpu: "0m",
      mem: "0Mi",
      qos: "BestEffort",
    },
    // default
    {
      ...n("hello-world-846b8c4f5d-77zzg", "default"),
      ready: "1/1",
      status: "Running",
      restarts: 0,
      ip: "10.244.1.66",
      node: NODES[0].name,
      ageSeconds: 60 * 60 * 3,
      cpu: "2m",
      mem: "12Mi",
      qos: "BestEffort",
    },
    {
      ...n("debug-shell-7zlmn", "default"),
      ready: "1/1",
      status: "Running",
      restarts: 0,
      ip: "10.244.3.7",
      node: NODES[2].name,
      ageSeconds: 60 * 17,
      cpu: "0m",
      mem: "4Mi",
      qos: "BestEffort",
    },
    {
      ...n("legacy-cron-prefetch-abc12", "default"),
      ready: "0/1",
      status: "Error",
      restarts: 8,
      lastRestart: "9m ago",
      ip: "10.244.1.111",
      node: NODES[0].name,
      ageSeconds: 60 * 60 * 2,
      cpu: "0m",
      mem: "0Mi",
      qos: "Burstable",
    },
    {
      ...n("session-tail-77f7d-zterm", "default"),
      ready: "1/1",
      status: "Terminating",
      restarts: 0,
      ip: "10.244.1.144",
      node: NODES[0].name,
      ageSeconds: 60 * 60 * 26,
      cpu: "0m",
      mem: "16Mi",
      qos: "BestEffort",
    },
    // kube-system
    {
      ...n("coredns-7569c87bbf-5l4mp", "kube-system"),
      ready: "1/1",
      status: "Running",
      restarts: 0,
      ip: "10.244.0.10",
      node: NODES[0].name,
      ageSeconds: 60 * 60 * 24 * 92,
      cpu: "3m",
      mem: "28Mi",
      qos: "Burstable",
    },
    {
      ...n("kube-proxy-9zk1l", "kube-system"),
      ready: "1/1",
      status: "Running",
      restarts: 0,
      ip: "10.0.2.44",
      node: NODES[1].name,
      ageSeconds: 60 * 60 * 24 * 92,
      cpu: "1m",
      mem: "18Mi",
      qos: "BestEffort",
    },
  ];

  const deployments: DeploymentRow[] = [
    {
      ...n("api-gateway", "payments"),
      ready: "2/2",
      upToDate: 2,
      available: 2,
      ageSeconds: 60 * 60 * 78,
      image: "ghcr.io/acme/api-gateway:1.42.0",
      selector: "app=api-gateway",
    },
    {
      ...n("settlement-worker", "payments"),
      ready: "0/1",
      upToDate: 1,
      available: 0,
      ageSeconds: 60 * 36,
      image: "ghcr.io/acme/settlement:0.9.3-rc",
      selector: "app=settlement-worker",
    },
    {
      ...n("fraud-scorer-canary", "payments"),
      ready: "1/1",
      upToDate: 1,
      available: 1,
      ageSeconds: 60 * 14,
      image: "ghcr.io/acme/fraud-scorer:canary",
      selector: "app=fraud-scorer,track=canary",
    },
    {
      ...n("ingress-nginx-controller", "platform"),
      ready: "1/1",
      upToDate: 1,
      available: 1,
      ageSeconds: 60 * 60 * 24 * 14,
      image: "registry.k8s.io/ingress-nginx/controller:v1.10.0",
      selector: "app.kubernetes.io/name=ingress-nginx",
    },
    {
      ...n("cert-manager", "platform"),
      ready: "1/1",
      upToDate: 1,
      available: 1,
      ageSeconds: 60 * 60 * 24 * 14,
      image: "quay.io/jetstack/cert-manager-controller:v1.15.1",
      selector: "app=cert-manager",
    },
    {
      ...n("vault-agent-injector", "platform"),
      ready: "0/1",
      upToDate: 1,
      available: 0,
      ageSeconds: 60 * 4,
      image: "hashicorp/vault-k8s:1.5.0-doesntexist",
      selector: "app.kubernetes.io/name=vault-agent-injector",
    },
    {
      ...n("argocd-server", "platform"),
      ready: "1/1",
      upToDate: 1,
      available: 1,
      ageSeconds: 60 * 60 * 24 * 7,
      image: "quay.io/argoproj/argocd:v2.13.0",
      selector: "app.kubernetes.io/name=argocd-server",
    },
    {
      ...n("grafana", "monitoring"),
      ready: "1/1",
      upToDate: 1,
      available: 1,
      ageSeconds: 60 * 60 * 24 * 30,
      image: "grafana/grafana:11.2.0",
      selector: "app.kubernetes.io/name=grafana",
    },
    {
      ...n("hello-world", "default"),
      ready: "1/1",
      upToDate: 1,
      available: 1,
      ageSeconds: 60 * 60 * 3,
      image: "nginxdemos/hello:plain-text",
      selector: "app=hello-world",
    },
  ];

  const services: ServiceRow[] = [
    {
      ...n("kubernetes", "default"),
      type: "ClusterIP",
      clusterIP: "10.96.0.1",
      externalIP: "<none>",
      ports: "443/TCP",
      ageSeconds: 60 * 60 * 24 * 92,
      selector: "<none>",
    },
    {
      ...n("api-gateway", "payments"),
      type: "ClusterIP",
      clusterIP: "10.96.142.4",
      externalIP: "<none>",
      ports: "80/TCP,443/TCP",
      ageSeconds: 60 * 60 * 78,
      selector: "app=api-gateway",
    },
    {
      ...n("settlement-worker", "payments"),
      type: "Headless",
      clusterIP: "None",
      externalIP: "<none>",
      ports: "9100/TCP",
      ageSeconds: 60 * 36,
      selector: "app=settlement-worker",
    },
    {
      ...n("ingress-nginx-controller", "platform"),
      type: "LoadBalancer",
      clusterIP: "10.96.220.41",
      externalIP: "a4b2c.eu-west-1.elb.amazonaws.com",
      ports: "80:31090/TCP,443:31443/TCP",
      ageSeconds: 60 * 60 * 24 * 14,
      selector: "app.kubernetes.io/name=ingress-nginx",
    },
    {
      ...n("argocd-server", "platform"),
      type: "NodePort",
      clusterIP: "10.96.55.12",
      externalIP: "<none>",
      ports: "80:30080/TCP,443:30443/TCP",
      ageSeconds: 60 * 60 * 24 * 7,
      selector: "app.kubernetes.io/name=argocd-server",
    },
    {
      ...n("grafana", "monitoring"),
      type: "ClusterIP",
      clusterIP: "10.96.91.7",
      externalIP: "<none>",
      ports: "80/TCP",
      ageSeconds: 60 * 60 * 24 * 30,
      selector: "app.kubernetes.io/name=grafana",
    },
    {
      ...n("prometheus", "monitoring"),
      type: "ClusterIP",
      clusterIP: "10.96.91.42",
      externalIP: "<none>",
      ports: "9090/TCP",
      ageSeconds: 60 * 60 * 24 * 30,
      selector: "app=prometheus",
    },
    {
      ...n("hello-world", "default"),
      type: "ClusterIP",
      clusterIP: "10.96.18.200",
      externalIP: "<none>",
      ports: "8080/TCP",
      ageSeconds: 60 * 60 * 3,
      selector: "app=hello-world",
    },
  ];

  const configMaps: ConfigMapRow[] = [
    {
      ...n("api-gateway-config", "payments"),
      dataKeys: 4,
      ageSeconds: 60 * 60 * 78,
      labels: "app=api-gateway",
    },
    {
      ...n("settlement-feature-flags", "payments"),
      dataKeys: 12,
      ageSeconds: 60 * 60 * 24 * 4,
      labels: "owner=payments",
    },
    {
      ...n("ingress-nginx-config", "platform"),
      dataKeys: 27,
      ageSeconds: 60 * 60 * 24 * 14,
      labels: "app.kubernetes.io/name=ingress-nginx",
    },
    {
      ...n("argocd-cm", "platform"),
      dataKeys: 9,
      ageSeconds: 60 * 60 * 24 * 7,
      labels: "app.kubernetes.io/name=argocd",
    },
    {
      ...n("prometheus-rules", "monitoring"),
      dataKeys: 18,
      ageSeconds: 60 * 60 * 24 * 30,
      labels: "app=prometheus",
    },
    {
      ...n("grafana-dashboards", "monitoring"),
      dataKeys: 22,
      ageSeconds: 60 * 60 * 24 * 30,
      labels: "app.kubernetes.io/name=grafana",
    },
    {
      ...n("kube-root-ca.crt", "default"),
      dataKeys: 1,
      ageSeconds: 60 * 60 * 24 * 92,
      labels: "<none>",
    },
  ];

  const secrets: SecretRow[] = [
    {
      ...n("api-gateway-tls", "payments"),
      type: "kubernetes.io/tls",
      dataKeys: 2,
      ageSeconds: 60 * 60 * 78,
    },
    {
      ...n("stripe-credentials", "payments"),
      type: "Opaque",
      dataKeys: 3,
      ageSeconds: 60 * 60 * 24 * 4,
    },
    {
      ...n("ghcr-pull-secret", "platform"),
      type: "kubernetes.io/dockerconfigjson",
      dataKeys: 1,
      ageSeconds: 60 * 60 * 24 * 14,
    },
    {
      ...n("argocd-server-tls", "platform"),
      type: "kubernetes.io/tls",
      dataKeys: 2,
      ageSeconds: 60 * 60 * 24 * 7,
    },
    {
      ...n("grafana-admin", "monitoring"),
      type: "Opaque",
      dataKeys: 2,
      ageSeconds: 60 * 60 * 24 * 30,
    },
    {
      ...n("default-token-x4klp", "default"),
      type: "kubernetes.io/service-account-token",
      dataKeys: 3,
      ageSeconds: 60 * 60 * 24 * 92,
    },
  ];

  const namespaces: NamespaceRow[] = NS.map((name) => {
    const pCount = pods.filter((p) => p.namespace === name).length;
    return {
      name,
      status: name === "default" ? "Active" : "Active",
      ageSeconds: 60 * 60 * 24 * 92,
      pods: pCount,
      labels:
        name === "kube-system"
          ? "kubernetes.io/metadata.name=kube-system"
          : `kubernetes.io/metadata.name=${name}`,
    };
  });

  return {
    context: "prod-eu-west",
    serverVersion: "v1.31.0",
    nodes: NODES.map((n) => ({ ...n, ready: true, version: "v1.31.0" })),
    namespaces,
    pods,
    deployments,
    services,
    configMaps,
    secrets,
  };
}

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
