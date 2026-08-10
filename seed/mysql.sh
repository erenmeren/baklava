#!/usr/bin/env bash
# Seed the MySQL compose service with a demo storefront schema so the
# Baklava MySQL workspace has something interesting to browse.
#
#   bash seed/mysql.sh
#
# Idempotent: drops & recreates the `demo` database on every run.
#
# Targets the compose-bundled mysql at localhost:3306. Override
# MYSQL_HOST/PORT/USER/PASSWORD/DATABASE in the environment to seed elsewhere.

set -euo pipefail

MYSQL_HOST="${MYSQL_HOST:-localhost}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-Baklava123!}"
MYSQL_DATABASE="${MYSQL_DATABASE:-demo}"

if command -v mysql >/dev/null 2>&1; then
  MYSQL=(mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" "-p$MYSQL_PASSWORD")
elif [ -n "$(docker compose ps -q mysql 2>/dev/null)" ]; then
  MYSQL=(docker compose exec -T mysql mysql -u "$MYSQL_USER" "-p$MYSQL_PASSWORD")
else
  echo "ERROR: need either mysql in PATH or a 'mysql' service in docker compose" >&2
  exit 1
fi

echo "→ seeding mysql ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}"

# Unquoted heredoc so ${MYSQL_DATABASE} interpolates — which is why every
# MySQL backtick below is escaped. (seed/postgres.sh quotes its heredoc
# because it needs no interpolation; don't copy that detail across.)
"${MYSQL[@]}" <<SQL
DROP DATABASE IF EXISTS \`${MYSQL_DATABASE}\`;
CREATE DATABASE \`${MYSQL_DATABASE}\`;
USE \`${MYSQL_DATABASE}\`;

CREATE TABLE customers (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(255) NOT NULL UNIQUE COMMENT 'login + contact address',
  name       VARCHAR(120) NOT NULL,
  country    CHAR(2)      NOT NULL,
  vip        TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'loyalty tier flag',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customers_country (country)
) COMMENT 'storefront customers';

CREATE TABLE products (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  sku         VARCHAR(32)  NOT NULL UNIQUE,
  name        VARCHAR(200) NOT NULL,
  category    VARCHAR(60)  NOT NULL,
  price_cents INT          NOT NULL,
  stock       INT          NOT NULL DEFAULT 0,
  INDEX idx_products_category (category),
  CONSTRAINT chk_products_price CHECK (price_cents >= 0)
);

CREATE TABLE orders (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  status      ENUM('pending','paid','shipped','delivered','cancelled')
              NOT NULL DEFAULT 'pending',
  total_cents INT    NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_orders_status (status),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Composite-PK table, so the Foreign keys tab has a key on a multi-column
-- table to render and the ordinal ordering in groupForeignKeyRows is real.
CREATE TABLE order_items (
  order_id   BIGINT NOT NULL,
  line_no    INT    NOT NULL,
  product_id BIGINT NOT NULL,
  qty        INT    NOT NULL,
  unit_cents INT    NOT NULL,
  PRIMARY KEY (order_id, line_no),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
    REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
    REFERENCES products(id),
  CONSTRAINT chk_order_items_qty CHECK (qty > 0)
);

INSERT INTO customers (email, name, country, vip) VALUES
  ('ava@example.com','Ava Stone','US',1),
  ('noah@example.com','Noah Reyes','US',0),
  ('liam@example.com','Liam Park','GB',0),
  ('olivia@example.com','Olivia Chen','CA',1),
  ('emma@example.com','Emma Garcia','ES',0);

INSERT INTO products (sku, name, category, price_cents, stock) VALUES
  ('SKU-001','Aurora Mechanical Keyboard','Peripherals',18900,42),
  ('SKU-002','Tempest 4K Monitor 27"','Displays',59900,18),
  ('SKU-003','Nimbus Wireless Mouse','Peripherals',7900,130),
  ('SKU-004','Atlas USB-C Dock 12-in-1','Accessories',14500,65),
  ('SKU-005','Vector Studio Headphones','Audio',29900,22);

INSERT INTO orders (customer_id, status, total_cents) VALUES
  (1,'paid',26800),(2,'pending',7900),(3,'shipped',59900),
  (4,'delivered',18900),(1,'cancelled',14500);

INSERT INTO order_items (order_id, line_no, product_id, qty, unit_cents) VALUES
  (1,1,1,1,18900),(1,2,3,1,7900),
  (2,1,3,1,7900),
  (3,1,2,1,59900),
  (4,1,1,1,18900),
  (5,1,4,1,14500);

CREATE VIEW top_customers AS
SELECT c.id, c.name, c.country, c.vip,
       COUNT(o.id) AS orders,
       COALESCE(SUM(o.total_cents),0)/100.0 AS lifetime_value
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name, c.country, c.vip
ORDER BY lifetime_value DESC;
SQL

cat <<DONE
✓ mysql seeded
  database: ${MYSQL_DATABASE}
  tables:   customers, products, orders, order_items
  views:    top_customers
  rows:     5 customers · 5 products · 5 orders · 6 order items

Open the Baklava UI → MySQL workspace and expand the demo database.
DONE
