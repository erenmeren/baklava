#!/usr/bin/env bash
# Seed the SQL Server compose service with a multi-database storefront so
# the Baklava SQL Server workspace has rich, SSMS-style data to browse —
# tables, views, sequences, user-defined types, table types, synonyms,
# procedures, functions, triggers (one of each, so every group in the
# sidebar lights up).
#
#   bash seed/sqlserver.sh
#
# Idempotent: drops & recreates the `BaklavaDemo` database on every run.
#
# Targets the compose-bundled sqlserver at localhost:1433 via docker
# compose exec + sqlcmd. Override SA_PASSWORD / SVC envs if needed.

set -euo pipefail

SVC="${SVC:-sqlserver}"
SA_PASSWORD="${SA_PASSWORD:-Baklava123!}"

if ! docker compose ps -q "$SVC" >/dev/null 2>&1 || \
   [ -z "$(docker compose ps -q "$SVC" 2>/dev/null)" ]; then
  echo "ERROR: docker compose service '$SVC' not running. Try: docker compose up -d $SVC" >&2
  exit 1
fi

SQLCMD=(docker compose exec -T "$SVC" /opt/mssql-tools18/bin/sqlcmd \
        -S localhost -U sa -P "$SA_PASSWORD" -No -b)

echo "→ seeding sqlserver localhost:1433 (BaklavaDemo)"

# Run as a here-doc piped through sqlcmd. GO splits batches as usual.
"${SQLCMD[@]}" <<'SQL'
IF DB_ID(N'BaklavaDemo') IS NOT NULL
BEGIN
  ALTER DATABASE BaklavaDemo SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
  DROP DATABASE BaklavaDemo;
END;
GO
CREATE DATABASE BaklavaDemo;
GO
USE BaklavaDemo;
GO

-- ── Schemas (so the sidebar shows more than just dbo) ────────────────
CREATE SCHEMA shop AUTHORIZATION dbo;
GO
CREATE SCHEMA analytics AUTHORIZATION dbo;
GO

-- ── User-defined types (Programmability → Types) ─────────────────────
CREATE TYPE shop.EmailAddress FROM NVARCHAR(254) NOT NULL;
GO
CREATE TYPE shop.MoneyCents FROM BIGINT NOT NULL;
GO

-- Table type (table-valued parameters)
CREATE TYPE shop.OrderLineTableType AS TABLE (
  ProductId  BIGINT      NOT NULL,
  Qty        INT         NOT NULL,
  UnitCents  BIGINT      NOT NULL
);
GO

-- ── Sequence (Programmability → Sequences) ───────────────────────────
CREATE SEQUENCE shop.OrderNumberSeq
  AS BIGINT
  START WITH 1000
  INCREMENT BY 1
  NO CYCLE
  CACHE 50;
GO

-- ── Tables ────────────────────────────────────────────────────────────
CREATE TABLE shop.Customers (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  Email       shop.EmailAddress    UNIQUE,
  Name        NVARCHAR(120)        NOT NULL,
  Country     CHAR(2)              NOT NULL,
  Vip         BIT                  NOT NULL DEFAULT 0,
  CreatedAt   DATETIME2            NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Customers_Country ON shop.Customers(Country);
GO

CREATE TABLE shop.Products (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  Sku         NVARCHAR(40)         NOT NULL UNIQUE,
  Name        NVARCHAR(200)        NOT NULL,
  Category    NVARCHAR(60)         NOT NULL,
  PriceCents  shop.MoneyCents,
  Stock       INT                  NOT NULL DEFAULT 0
);
CREATE INDEX IX_Products_Category ON shop.Products(Category);
GO

CREATE TABLE shop.Orders (
  Id           BIGINT IDENTITY(1,1) PRIMARY KEY,
  OrderNumber  BIGINT               NOT NULL UNIQUE,
  CustomerId   BIGINT               NOT NULL
    REFERENCES shop.Customers(Id) ON DELETE CASCADE,
  Status       NVARCHAR(20)         NOT NULL DEFAULT N'pending',
  TotalCents   shop.MoneyCents,
  CreatedAt    DATETIME2            NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Orders_Customer ON shop.Orders(CustomerId);
CREATE INDEX IX_Orders_Status ON shop.Orders(Status);
GO

CREATE TABLE shop.OrderItems (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  OrderId     BIGINT               NOT NULL
    REFERENCES shop.Orders(Id) ON DELETE CASCADE,
  ProductId   BIGINT               NOT NULL REFERENCES shop.Products(Id),
  Qty         INT                  NOT NULL,
  UnitCents   shop.MoneyCents
);
CREATE INDEX IX_OrderItems_Order ON shop.OrderItems(OrderId);
GO

-- ── Sample data ───────────────────────────────────────────────────────
INSERT INTO shop.Customers (Email, Name, Country, Vip) VALUES
  (N'ava@example.com',     N'Ava Stone',    'US', 1),
  (N'noah@example.com',    N'Noah Reyes',   'US', 0),
  (N'liam@example.com',    N'Liam Park',    'GB', 0),
  (N'olivia@example.com',  N'Olivia Chen',  'CA', 1),
  (N'elijah@example.com',  N'Elijah Watts', 'US', 0),
  (N'emma@example.com',    N'Emma Garcia',  'ES', 0),
  (N'mason@example.com',   N'Mason Wright', 'AU', 1),
  (N'sophia@example.com',  N'Sophia Diaz',  'MX', 0),
  (N'lucas@example.com',   N'Lucas Hall',   'DE', 0),
  (N'isabella@example.com',N'Isabella Roy', 'IN', 1);

INSERT INTO shop.Products (Sku, Name, Category, PriceCents, Stock) VALUES
  (N'SKU-001', N'Aurora Mechanical Keyboard',  N'Peripherals',  18900, 42),
  (N'SKU-002', N'Tempest 4K Monitor 27"',      N'Displays',     59900, 18),
  (N'SKU-003', N'Nimbus Wireless Mouse',       N'Peripherals',   7900, 130),
  (N'SKU-004', N'Atlas USB-C Dock 12-in-1',    N'Accessories',  14500, 65),
  (N'SKU-005', N'Vector Studio Headphones',    N'Audio',        29900, 22),
  (N'SKU-006', N'Pulse Webcam 1080p',          N'Video',         8900, 80),
  (N'SKU-007', N'Halo Ring Light Pro',         N'Video',        11200, 35),
  (N'SKU-008', N'Strata Standing Desk Mat',    N'Office',        4900, 200),
  (N'SKU-009', N'Helix Cable Organizer Kit',   N'Office',        1900, 500),
  (N'SKU-010', N'Solstice Smart Lamp',         N'Office',        6900, 60);
GO

-- 60 random orders, each with a sequence-driven OrderNumber.
WITH src AS (
  SELECT TOP (60)
    ((ABS(CHECKSUM(NEWID())) % 10) + 1) AS CustomerId,
    ((ABS(CHECKSUM(NEWID())) % 5) + 1)  AS StatusIdx,
    DATEADD(DAY, -ABS(CHECKSUM(NEWID())) % 60, SYSUTCDATETIME()) AS CreatedAt
  FROM sys.all_objects
  WHERE [object_id] IS NOT NULL
)
INSERT INTO shop.Orders (OrderNumber, CustomerId, Status, TotalCents, CreatedAt)
SELECT
  NEXT VALUE FOR shop.OrderNumberSeq,
  CustomerId,
  CHOOSE(StatusIdx, N'pending', N'paid', N'shipped', N'delivered', N'cancelled'),
  0,
  CreatedAt
FROM src;
GO

-- ~180 random items spread across the orders.
INSERT INTO shop.OrderItems (OrderId, ProductId, Qty, UnitCents)
SELECT TOP (180)
  o.Id,
  p.Id,
  (ABS(CHECKSUM(NEWID())) % 3) + 1,
  p.PriceCents
FROM shop.Orders o
CROSS JOIN shop.Products p
ORDER BY NEWID();
GO

-- Backfill totals.
UPDATE o
SET TotalCents = sub.Total
FROM shop.Orders o
JOIN (
  SELECT OrderId, SUM(CAST(Qty AS BIGINT) * UnitCents) AS Total
  FROM shop.OrderItems
  GROUP BY OrderId
) sub ON sub.OrderId = o.Id;
GO

-- ── View ──────────────────────────────────────────────────────────────
CREATE VIEW analytics.DailyRevenue AS
SELECT
  CAST(o.CreatedAt AS DATE) AS [Day],
  COUNT(*)                  AS Orders,
  SUM(o.TotalCents) / 100.0 AS Revenue
FROM shop.Orders o
WHERE o.Status <> N'cancelled'
GROUP BY CAST(o.CreatedAt AS DATE);
GO

-- ── Procedure ─────────────────────────────────────────────────────────
CREATE PROCEDURE shop.GetCustomerOrders
  @CustomerId BIGINT
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    o.Id,
    o.OrderNumber,
    o.Status,
    o.TotalCents / 100.0 AS TotalDollars,
    o.CreatedAt
  FROM shop.Orders o
  WHERE o.CustomerId = @CustomerId
  ORDER BY o.CreatedAt DESC;
END;
GO

-- ── Scalar function ───────────────────────────────────────────────────
CREATE FUNCTION shop.FormatMoney(@Cents BIGINT)
RETURNS NVARCHAR(20)
AS
BEGIN
  RETURN N'$' + FORMAT(@Cents / 100.0, N'N2');
END;
GO

-- ── Trigger ───────────────────────────────────────────────────────────
CREATE TRIGGER shop.trg_Orders_StampStatus
ON shop.Orders
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF UPDATE(Status)
  BEGIN
    -- For demo purposes: do nothing destructive. In real life this would
    -- write to an audit table — kept minimal so the trigger shows in the
    -- sidebar without complicating the schema.
    PRINT N'Order status changed.';
  END;
END;
GO

-- ── Synonym ───────────────────────────────────────────────────────────
CREATE SYNONYM shop.AllCustomers FOR shop.Customers;
GO
SQL

cat <<DONE
✓ sqlserver seeded
  database: BaklavaDemo
  schemas:  shop, analytics
  tables:   shop.Customers, shop.Products, shop.Orders, shop.OrderItems
  view:     analytics.DailyRevenue
  proc:     shop.GetCustomerOrders
  func:     shop.FormatMoney
  trigger:  shop.trg_Orders_StampStatus
  synonym:  shop.AllCustomers → shop.Customers
  sequence: shop.OrderNumberSeq (started at 1000)
  type:     shop.EmailAddress, shop.MoneyCents (alias) + shop.OrderLineTableType
  rows:     10 customers · 10 products · 60 orders · ~180 order items

Open the Baklava UI → SQL Server workspace → expand BaklavaDemo → shop.
Every group in the sidebar (Tables/Views/Procedures/Functions/Sequences/
User-Defined Types/Table Types/Synonyms/Triggers) will have a row.
DONE
