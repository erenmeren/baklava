#!/usr/bin/env bash
# Seed the Postgres compose service with a demo storefront schema so the
# Baklava Postgres workspace has something interesting to browse.
#
#   bash seed/postgres.sh
#
# Idempotent: drops & recreates the `shop` and `analytics` schemas on every
# run, so it's safe to re-run after iterating on the seed data.
#
# Targets the compose-bundled postgres at localhost:5432. To seed a remote
# instance, override PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE in the
# environment (the script just sets sane defaults).

set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-Baklava123!}"
export PGDATABASE="${PGDATABASE:-demo}"

# Prefer a local psql when available — it's the same client and lets the
# script work even if the compose container is named something unexpected.
# Otherwise fall back to docker compose exec.
if command -v psql >/dev/null 2>&1; then
  PSQL=(psql -v ON_ERROR_STOP=1 -X)
elif docker compose ps -q postgres >/dev/null 2>&1 && \
     [ -n "$(docker compose ps -q postgres 2>/dev/null)" ]; then
  PSQL=(docker compose exec -T -e "PGPASSWORD=$PGPASSWORD" postgres \
        psql -v ON_ERROR_STOP=1 -X -U "$PGUSER" -d "$PGDATABASE")
  # When we shell through docker, host/port are pointless (it's the
  # container's localhost) — unset so the heredoc reaches the right db.
  unset PGHOST PGPORT
else
  echo "ERROR: need either psql in PATH or 'postgres' service in docker compose" >&2
  exit 1
fi

echo "→ seeding postgres ${PGHOST:-(compose)}:${PGPORT:-5432}/${PGDATABASE}"

"${PSQL[@]}" <<'SQL'
DROP SCHEMA IF EXISTS shop CASCADE;
DROP SCHEMA IF EXISTS analytics CASCADE;

CREATE SCHEMA shop;
CREATE SCHEMA analytics;

SET search_path TO shop;

-- ── Tables ────────────────────────────────────────────────────────────
CREATE TABLE customers (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  country     TEXT NOT NULL,
  vip         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_customers_country ON customers(country);

CREATE TABLE products (
  id          BIGSERIAL PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_products_category ON products(category);

CREATE TYPE order_status AS ENUM ('pending','paid','shipped','delivered','cancelled');

CREATE TABLE orders (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status       order_status NOT NULL DEFAULT 'pending',
  total_cents  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE order_items (
  id          BIGSERIAL PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  BIGINT NOT NULL REFERENCES products(id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  unit_cents  INTEGER NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ── Sample data ───────────────────────────────────────────────────────
INSERT INTO customers (email, name, country, vip) VALUES
  ('ava@example.com',     'Ava Stone',    'US', true),
  ('noah@example.com',    'Noah Reyes',   'US', false),
  ('liam@example.com',    'Liam Park',    'GB', false),
  ('olivia@example.com',  'Olivia Chen',  'CA', true),
  ('elijah@example.com',  'Elijah Watts', 'US', false),
  ('emma@example.com',    'Emma Garcia',  'ES', false),
  ('mason@example.com',   'Mason Wright', 'AU', true),
  ('sophia@example.com',  'Sophia Diaz',  'MX', false),
  ('lucas@example.com',   'Lucas Hall',   'DE', false),
  ('isabella@example.com','Isabella Roy', 'IN', true);

INSERT INTO products (sku, name, category, price_cents, stock) VALUES
  ('SKU-001', 'Aurora Mechanical Keyboard',     'Peripherals',   18900, 42),
  ('SKU-002', 'Tempest 4K Monitor 27"',         'Displays',      59900, 18),
  ('SKU-003', 'Nimbus Wireless Mouse',          'Peripherals',    7900, 130),
  ('SKU-004', 'Atlas USB-C Dock 12-in-1',       'Accessories',   14500, 65),
  ('SKU-005', 'Vector Studio Headphones',       'Audio',         29900, 22),
  ('SKU-006', 'Pulse Webcam 1080p',             'Video',          8900, 80),
  ('SKU-007', 'Halo Ring Light Pro',            'Video',         11200, 35),
  ('SKU-008', 'Strata Standing Desk Mat',       'Office',         4900, 200),
  ('SKU-009', 'Helix Cable Organizer Kit',      'Office',         1900, 500),
  ('SKU-010', 'Solstice Smart Lamp',            'Office',         6900, 60);

INSERT INTO orders (customer_id, status, total_cents, created_at)
SELECT
  ((random() * 9)::int + 1)            AS customer_id,
  (ARRAY['pending','paid','shipped','delivered','cancelled']::order_status[])
    [(random() * 4)::int + 1]          AS status,
  0                                    AS total_cents,
  NOW() - (random() * INTERVAL '60 days')
FROM generate_series(1, 60);

INSERT INTO order_items (order_id, product_id, qty, unit_cents)
SELECT
  o.id,
  ((random() * 9)::int + 1)            AS product_id,
  ((random() * 3)::int + 1)            AS qty,
  p.price_cents
FROM orders o, products p
WHERE p.id = ((random() * 9)::int + 1)
ORDER BY random()
LIMIT 180;

-- Backfill order totals from items.
UPDATE orders o
SET total_cents = sub.total
FROM (
  SELECT order_id, SUM(qty * unit_cents) AS total
  FROM order_items
  GROUP BY order_id
) sub
WHERE sub.order_id = o.id;

-- ── Views in the analytics schema ─────────────────────────────────────
CREATE VIEW analytics.daily_revenue AS
SELECT
  date_trunc('day', created_at)::date AS day,
  COUNT(*)                            AS order_count,
  SUM(total_cents) / 100.0            AS revenue
FROM shop.orders
WHERE status NOT IN ('cancelled')
GROUP BY 1
ORDER BY 1 DESC;

CREATE VIEW analytics.top_customers AS
SELECT
  c.id,
  c.name,
  c.country,
  c.vip,
  COUNT(o.id)              AS orders,
  COALESCE(SUM(o.total_cents), 0) / 100.0 AS lifetime_value
FROM shop.customers c
LEFT JOIN shop.orders o ON o.customer_id = c.id
GROUP BY c.id
ORDER BY lifetime_value DESC;
SQL

cat <<DONE
✓ postgres seeded
  schemas:  shop, analytics
  tables:   shop.customers, shop.products, shop.orders, shop.order_items
  views:    analytics.daily_revenue, analytics.top_customers
  rows:     10 customers · 10 products · 60 orders · ~180 order items

Open the Baklava UI → PostgreSQL workspace and expand the demo database.
DONE
