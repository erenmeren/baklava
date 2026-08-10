#!/usr/bin/env bash
# Run every seed script in order. Expects `docker compose up -d` to
# already be done (and the Docker daemon running for the docker seed).
#
#   bash seed/all.sh

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "═══ docker ═══════════════════════════════════════════════════════"
bash "$here/docker.sh"
echo

echo "═══ postgres ═════════════════════════════════════════════════════"
bash "$here/postgres.sh"
echo

echo "═══ mysql ════════════════════════════════════════════════════════"
bash "$here/mysql.sh"
echo

echo "═══ kafka ════════════════════════════════════════════════════════"
bash "$here/kafka.sh"
echo

echo "═══ sqlserver ════════════════════════════════════════════════════"
bash "$here/sqlserver.sh"
echo

echo "✓ all seeders finished. Open http://localhost:3000 to browse."
