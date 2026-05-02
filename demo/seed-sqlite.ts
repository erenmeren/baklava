/**
 * Seeds two SQLite databases for the headline `npx baklava --demo` flow.
 *
 *   demo-app.db    users (id, email, plan_tier, signup_date)
 *   demo-events.db orders (id, user_id, status, amount_cents, created_at)
 *
 * Then writes both as connections into ~/.baklava/connections.json so the
 * pipeline is ready to query without any further setup.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  baklavaDir,
  CURRENT_SCHEMA_VERSION,
  loadConnections,
  saveConnections,
  type ConnectionsFile,
} from "../lib/config.js";
import { mkdirSync } from "node:fs";

const APP_DB = "demo-app.db";
const EVENTS_DB = "demo-events.db";
const APP_CONNECTION = "demo-app";
const EVENTS_CONNECTION = "demo-events";

interface SeedResult {
  appPath: string;
  eventsPath: string;
  rows: { users: number; orders: number };
  reseeded: boolean;
}

export function seedDemo(opts: { force?: boolean } = {}): SeedResult {
  const dir = baklavaDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const appPath = join(dir, APP_DB);
  const eventsPath = join(dir, EVENTS_DB);

  const reseeded = opts.force === true || !existsSync(appPath) || !existsSync(eventsPath);
  if (reseeded) {
    seedApp(appPath);
    seedEvents(eventsPath);
  }

  upsertConnection(APP_CONNECTION, "sqlite", { path: appPath });
  upsertConnection(EVENTS_CONNECTION, "sqlite", { path: eventsPath });

  const rows = countRows(appPath, eventsPath);
  return { appPath, eventsPath, rows, reseeded };
}

function seedApp(path: string): void {
  if (existsSync(path)) {
    new Database(path).close(); // ensure clean handle
  }
  const db = new Database(path);
  try {
    db.exec(`
      DROP TABLE IF EXISTS users;
      CREATE TABLE users (
        id INTEGER NOT NULL PRIMARY KEY,
        email TEXT NOT NULL,
        plan_tier TEXT NOT NULL,
        signup_date TEXT NOT NULL
      );
    `);
    const insert = db.prepare(
      "INSERT INTO users (id, email, plan_tier, signup_date) VALUES (?, ?, ?, ?)"
    );
    const rows: [number, string, string, string][] = [
      [1, "alice@example.com", "pro", "2026-01-12"],
      [2, "bob@example.com", "free", "2026-01-18"],
      [3, "carol@example.com", "pro", "2026-02-04"],
      [4, "dave@example.com", "free", "2026-02-22"],
      [5, "eve@example.com", "team", "2026-03-09"],
      [6, "frank@example.com", "pro", "2026-03-15"],
      [7, "grace@example.com", "free", "2026-04-01"],
      [8, "hank@example.com", "pro", "2026-04-12"],
      [9, "ivy@example.com", "team", "2026-04-25"],
      [10, "jack@example.com", "pro", "2026-05-01"],
    ];
    const tx = db.transaction((batch: typeof rows) => {
      for (const r of batch) insert.run(...r);
    });
    tx(rows);
  } finally {
    db.close();
  }
}

function seedEvents(path: string): void {
  if (existsSync(path)) {
    new Database(path).close();
  }
  const db = new Database(path);
  try {
    db.exec(`
      DROP TABLE IF EXISTS orders;
      CREATE TABLE orders (
        id INTEGER NOT NULL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const insert = db.prepare(
      "INSERT INTO orders (id, user_id, status, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const rows: [number, number, string, number, string][] = [
      [101, 1, "paid", 4900, "2026-04-28T10:11:00Z"],
      [102, 1, "paid", 9900, "2026-05-01T14:32:00Z"],
      [103, 2, "abandoned", 4900, "2026-04-30T08:01:00Z"],
      [104, 3, "paid", 9900, "2026-05-01T11:00:00Z"],
      [105, 5, "paid", 19900, "2026-05-02T09:21:00Z"],
      [106, 6, "refunded", 4900, "2026-04-29T16:42:00Z"],
      [107, 8, "paid", 9900, "2026-05-02T17:55:00Z"],
      [108, 9, "paid", 19900, "2026-05-02T20:10:00Z"],
      [109, 10, "abandoned", 9900, "2026-05-02T21:45:00Z"],
      [110, 1, "paid", 4900, "2026-05-02T22:00:00Z"],
    ];
    const tx = db.transaction((batch: typeof rows) => {
      for (const r of batch) insert.run(...r);
    });
    tx(rows);
  } finally {
    db.close();
  }
}

function countRows(appPath: string, eventsPath: string): { users: number; orders: number } {
  const app = new Database(appPath, { readonly: true });
  const events = new Database(eventsPath, { readonly: true });
  try {
    const users = (app.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
    const orders = (events.prepare("SELECT count(*) AS n FROM orders").get() as { n: number })
      .n;
    return { users, orders };
  } finally {
    app.close();
    events.close();
  }
}

function upsertConnection(
  name: string,
  plugin: string,
  config: Record<string, unknown>
): void {
  const file: ConnectionsFile = loadConnections();
  const existingIdx = file.connections.findIndex((c) => c.name === name);
  if (existingIdx >= 0) {
    file.connections[existingIdx] = { name, plugin, config };
  } else {
    file.connections.push({ name, plugin, config });
  }
  file.schema_version = CURRENT_SCHEMA_VERSION;
  saveConnections(file);
}
