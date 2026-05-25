#!/usr/bin/env bash
# Seed the local Docker daemon with a few images, a stack-labelled
# container set, a network, and a volume — so the Baklava Docker
# workspace has interesting things to browse on first open.
#
#   bash seed/docker.sh
#
# Idempotent: removes any baklava-demo-* artefacts from a previous run,
# then recreates them. The compose-managed `postgres`, `kafka`, and
# `sqlserver` containers are left alone.

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker CLI not found in PATH" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon not reachable (try: open Docker Desktop)" >&2
  exit 1
fi

PREFIX=baklava-demo
NET="${PREFIX}-net"
VOL="${PREFIX}-data"

# ── Pull a handful of common images ───────────────────────────────────
echo "→ pulling demo images"
for img in nginx:alpine busybox:latest alpine:3.20 hello-world:latest; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    echo "  · pulling $img"
    docker pull "$img" >/dev/null
  else
    echo "  · already have $img"
  fi
done

# ── Clean up previous demo artefacts ──────────────────────────────────
echo "→ resetting any previous ${PREFIX}-* containers"
docker ps -a --filter "label=baklava.demo=1" --format '{{.Names}}' \
  | xargs -I{} docker rm -f {} >/dev/null 2>&1 || true
docker network rm "$NET" >/dev/null 2>&1 || true
docker volume rm "$VOL" >/dev/null 2>&1 || true

# ── Network + volume ──────────────────────────────────────────────────
docker network create "$NET" --label baklava.demo=1 >/dev/null
docker volume create "$VOL" --label baklava.demo=1 >/dev/null

# ── Containers (the small demo "stack") ───────────────────────────────
run() {
  local name="$1"; shift
  docker run -d \
    --name "$name" \
    --network "$NET" \
    --label baklava.demo=1 \
    --label "baklava.stack.name=demo" \
    --label "baklava.stack.service=${name#${PREFIX}-}" \
    --restart unless-stopped \
    "$@" >/dev/null
  echo "  · started $name"
}

echo "→ starting demo containers"
run "${PREFIX}-web"   -p 18080:80 nginx:alpine
run "${PREFIX}-cache" -v "$VOL:/data" busybox:latest sh -c \
  'echo "started: $(date)" >> /data/log; sleep infinity'
run "${PREFIX}-worker" alpine:3.20 sh -c \
  'i=0; while true; do echo "tick $i $(date)"; i=$((i+1)); sleep 5; done'

cat <<DONE
✓ docker seeded
  images:     nginx:alpine, busybox, alpine:3.20, hello-world
  network:    ${NET}
  volume:     ${VOL}
  containers: ${PREFIX}-web (nginx on :18080), ${PREFIX}-cache, ${PREFIX}-worker
  stack:      'demo' — all three containers carry baklava.stack.name=demo

Open the Baklava UI → Docker workspace → Containers and you'll see the
demo containers running. Stacks tab groups them. nginx is reachable at
http://localhost:18080. Re-run this script anytime to reset the demo.
DONE
