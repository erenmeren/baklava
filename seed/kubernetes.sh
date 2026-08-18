#!/usr/bin/env bash
# Seed the local k3s cluster with a demo workload the Kubernetes workspace can
# browse: a namespace holding a Deployment (two replicas, two containers so the
# container picker has something to pick), a Service, a ConfigMap, a Secret, a
# StatefulSet, a DaemonSet, a Job, a CronJob, an Ingress and a PVC — plus one
# deliberately-crashing pod so the Events screen and `describe` have something
# real to show.
#
#   docker compose up -d k3s
#   bash seed/kubernetes.sh
#
# Requires kubectl. KUBECONFIG defaults to the compose service's output.
set -euo pipefail

export KUBECONFIG="${KUBECONFIG:-$(cd "$(dirname "$0")/.." && pwd)/.kube/kubeconfig.yaml}"

# k3s ships kubectl inside the container, so a host without it still works:
# fall back to running kubectl in the compose service.
if command -v kubectl >/dev/null 2>&1; then
  kube() { kubectl "$@"; }
elif docker compose ps k3s >/dev/null 2>&1; then
  echo "kubectl not found on PATH — using the one inside the k3s container."
  kube() { docker compose exec -T k3s kubectl "$@"; }
else
  echo "Neither kubectl nor a running k3s compose service found." >&2
  echo "Start the cluster first:  docker compose up -d k3s" >&2
  exit 1
fi

echo "waiting for the cluster to accept connections…"
for _ in $(seq 1 90); do
  kube get --raw /readyz >/dev/null 2>&1 && break
  sleep 2
done

# The namespace goes first and we wait for its `default` ServiceAccount:
# controllers retry, but a bare Pod applied in the same breath is rejected
# outright with "serviceaccount default not found".
kube apply -f - <<'NS'
apiVersion: v1
kind: Namespace
metadata:
  name: demo
  labels: { app.kubernetes.io/part-of: baklava-demo }
NS

for _ in $(seq 1 60); do
  kube -n demo get serviceaccount default >/dev/null 2>&1 && break
  sleep 1
done

kube apply -f - <<'MANIFEST'
apiVersion: v1
kind: ConfigMap
metadata: { name: storefront-config, namespace: demo }
data:
  APP_ENV: production
  FEATURE_FLAGS: "checkout_v2,fast_search"
---
apiVersion: v1
kind: Secret
metadata: { name: storefront-credentials, namespace: demo }
type: Opaque
stringData:
  DB_PASSWORD: not-a-real-password
  API_TOKEN: not-a-real-token
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: storefront, namespace: demo }
spec:
  replicas: 2
  selector: { matchLabels: { app: storefront } }
  template:
    metadata: { labels: { app: storefront } }
    spec:
      containers:
        # Two containers so the log/exec container picker is exercised.
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          resources: { requests: { cpu: 10m, memory: 32Mi } }
        - name: sidecar
          image: busybox:1.36
          command: ["sh", "-c", "while true; do echo sidecar heartbeat; sleep 15; done"]
          resources: { requests: { cpu: 5m, memory: 16Mi } }
---
apiVersion: v1
kind: Service
metadata: { name: storefront, namespace: demo }
spec:
  selector: { app: storefront }
  ports: [{ port: 80, targetPort: 80 }]
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: ledger, namespace: demo }
spec:
  serviceName: ledger
  replicas: 1
  selector: { matchLabels: { app: ledger } }
  template:
    metadata: { labels: { app: ledger } }
    spec:
      containers:
        - name: ledger
          image: busybox:1.36
          command: ["sh", "-c", "while true; do sleep 30; done"]
          resources: { requests: { cpu: 5m, memory: 16Mi } }
---
apiVersion: apps/v1
kind: DaemonSet
metadata: { name: log-shipper, namespace: demo }
spec:
  selector: { matchLabels: { app: log-shipper } }
  template:
    metadata: { labels: { app: log-shipper } }
    spec:
      containers:
        - name: shipper
          image: busybox:1.36
          command: ["sh", "-c", "while true; do sleep 30; done"]
          resources: { requests: { cpu: 5m, memory: 16Mi } }
---
apiVersion: batch/v1
kind: Job
metadata: { name: migrate-schema, namespace: demo }
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: busybox:1.36
          command: ["sh", "-c", "echo migrating; sleep 2; echo done"]
---
apiVersion: batch/v1
kind: CronJob
metadata: { name: nightly-report, namespace: demo }
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: report
              image: busybox:1.36
              command: ["sh", "-c", "echo report generated"]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: storefront, namespace: demo }
spec:
  rules:
    - host: storefront.demo.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: storefront, port: { number: 80 } } }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: ledger-data, namespace: demo }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
---
# Deliberately broken: gives the Events screen and `describe` a real
# CrashLoopBackOff / ImagePullBackOff to show.
apiVersion: v1
kind: Pod
metadata: { name: broken-image, namespace: demo }
spec:
  containers:
    - name: nope
      image: baklava.invalid/does-not-exist:1
MANIFEST

echo "waiting for the storefront deployment to come up…"
kube -n demo rollout status deployment/storefront --timeout=120s || true

echo
echo "seeded namespace 'demo':"
kube -n demo get all
