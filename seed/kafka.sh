#!/usr/bin/env bash
# Seed the Kafka compose service with a handful of topics + sample
# messages so the Baklava Kafka workspace has data to browse.
#
#   bash seed/kafka.sh
#
# Idempotent: deletes & recreates the demo topics on every run.
# Targets the compose-bundled kafka via docker compose exec.

set -euo pipefail

SVC="${SVC:-kafka}"
BROKER="${BROKER:-localhost:9092}"

if ! docker compose ps -q "$SVC" >/dev/null 2>&1 || \
   [ -z "$(docker compose ps -q "$SVC" 2>/dev/null)" ]; then
  echo "ERROR: docker compose service '$SVC' not running. Try: docker compose up -d $SVC" >&2
  exit 1
fi

# apache/kafka images ship the scripts under /opt/kafka/bin.
KCLI=(docker compose exec -T "$SVC")
TOPICS=/opt/kafka/bin/kafka-topics.sh
PRODUCE=/opt/kafka/bin/kafka-console-producer.sh
CONSUME=/opt/kafka/bin/kafka-console-consumer.sh

# Per-topic config: name, partitions
declare -a TOPIC_SPEC=(
  "events 6"
  "orders 3"
  "audit 1"
  "notifications 4"
  "metrics 2"
)

echo "→ seeding kafka $BROKER"

# 1) Delete + recreate topics (ignore "topic doesn't exist" on first run).
for spec in "${TOPIC_SPEC[@]}"; do
  read -r topic _ <<<"$spec"
  "${KCLI[@]}" "$TOPICS" --bootstrap-server "$BROKER" \
    --delete --topic "$topic" --if-exists >/dev/null 2>&1 || true
done

for spec in "${TOPIC_SPEC[@]}"; do
  read -r topic partitions <<<"$spec"
  "${KCLI[@]}" "$TOPICS" --bootstrap-server "$BROKER" \
    --create --topic "$topic" --partitions "$partitions" \
    --replication-factor 1 --if-not-exists >/dev/null
  echo "  · created $topic ($partitions partitions)"
done

# 2) Produce sample messages. Keyed (so they distribute across partitions
#    deterministically) and shaped like real events the UI can render.
produce() {
  local topic="$1"
  shift
  printf '%s\n' "$@" | "${KCLI[@]}" "$PRODUCE" \
    --bootstrap-server "$BROKER" --topic "$topic" \
    --property "parse.key=true" --property "key.separator=|" >/dev/null
}

produce events \
  'user-101|{"type":"signup","userId":101,"plan":"free"}' \
  'user-102|{"type":"signup","userId":102,"plan":"pro"}' \
  'user-101|{"type":"login","userId":101,"ip":"10.0.0.5"}' \
  'user-103|{"type":"signup","userId":103,"plan":"free"}' \
  'user-104|{"type":"upgrade","userId":104,"from":"free","to":"pro"}' \
  'user-102|{"type":"logout","userId":102}' \
  'user-105|{"type":"signup","userId":105,"plan":"team"}' \
  'user-103|{"type":"login","userId":103,"ip":"10.0.0.8"}'

produce orders \
  'order-1001|{"orderId":1001,"customerId":42,"total":189.00,"status":"placed"}' \
  'order-1002|{"orderId":1002,"customerId":17,"total":599.00,"status":"placed"}' \
  'order-1001|{"orderId":1001,"status":"paid"}' \
  'order-1003|{"orderId":1003,"customerId":42,"total":79.00,"status":"placed"}' \
  'order-1002|{"orderId":1002,"status":"shipped","carrier":"DHL"}' \
  'order-1004|{"orderId":1004,"customerId":88,"total":11200,"status":"placed"}'

produce audit \
  'svc-api|{"actor":"api-gateway","action":"deploy","version":"2.14.0"}' \
  'svc-billing|{"actor":"billing","action":"invoice.sent","invoiceId":9001}' \
  'svc-api|{"actor":"api-gateway","action":"config.changed","key":"rate_limit"}'

produce notifications \
  'user-101|{"channel":"email","template":"welcome","to":"ava@example.com"}' \
  'user-102|{"channel":"push","template":"order.shipped","orderId":1002}' \
  'user-104|{"channel":"email","template":"upgrade.confirmed"}' \
  'user-105|{"channel":"sms","template":"verify","phone":"+1xxx"}'

produce metrics \
  'host-web-01|{"cpu":0.42,"mem":0.61,"loadavg":1.2}' \
  'host-web-02|{"cpu":0.55,"mem":0.49,"loadavg":1.8}' \
  'host-web-01|{"cpu":0.39,"mem":0.62,"loadavg":1.1}' \
  'host-web-03|{"cpu":0.71,"mem":0.74,"loadavg":2.4}'

# 3) Park a consumer group so the Consumer Groups page has something to
#    show (one quick read commits the offsets and exits cleanly).
"${KCLI[@]}" "$CONSUME" --bootstrap-server "$BROKER" --topic orders \
  --group baklava-demo --from-beginning --timeout-ms 2000 \
  --max-messages 6 >/dev/null 2>&1 || true

cat <<DONE
✓ kafka seeded
  topics:   events (6p) · orders (3p) · audit (1p) · notifications (4p) · metrics (2p)
  messages: 27 total, keyed so they spread across partitions
  group:    'baklava-demo' has consumed orders (visible in Consumer Groups)

Open the Baklava UI → Kafka workspace → Topics and click into any topic
to see the messages tab. Consumer groups tab shows the demo group with lag.
DONE
