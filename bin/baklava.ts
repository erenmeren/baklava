#!/usr/bin/env node

/**
 * baklava CLI.
 *
 *   baklava                  — start the local web UI (next dev)
 *   baklava --demo           — seed the demo SQLite pair, then start
 *   baklava --port <n>       — bind to a different port (default 3000)
 *   baklava --help           — usage
 *   baklava version          — print version
 *   baklava doctor           — diagnose setup
 *
 * The server binds to 127.0.0.1 only. baklava is local-first by design.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedDemo } from "../demo/seed-sqlite";
import { loadConnections, getAnthropicApiKey, BAKLAVA_DIR } from "../lib/config";
import { listPlugins } from "../lib/plugins";
import { getOrCreateInstanceToken } from "../lib/security";
import { isBaklavaError } from "../lib/errors";

const require = createRequire(import.meta.url);

interface ParsedArgs {
  command: "start" | "version" | "doctor" | "help";
  demo: boolean;
  port: number;
  help: boolean;
}

const HELP = `
baklava — the unified developer console for the modern stack

Usage:
  baklava                  Start the local UI on http://localhost:3000
  baklava --demo           Seed two SQLite databases and start the demo
  baklava --port 3456      Bind to a different port (still 127.0.0.1 only)
  baklava version          Print the installed version
  baklava doctor           Show config and connection status
  baklava --help           This message

Environment:
  ANTHROPIC_API_KEY        Used to translate questions into SQL plans.
                           If unset, baklava reads from ~/.baklava/config.json.
  BAKLAVA_HOME             Override ~/.baklava (test isolation).
  BAKLAVA_DUCK_MEMORY_LIMIT  DuckDB memory ceiling (default 4GB).

Local-first: data stays on this machine. baklava only sends your
question and the schemas of your connected sources to Anthropic; row
data is never sent off-device.
`;

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { command: "start", demo: false, port: 3000, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--demo":
        args.demo = true;
        break;
      case "--port":
      case "-p": {
        const next = argv[++i];
        if (!next) throw new Error("--port requires a number");
        const n = Number(next);
        if (!Number.isInteger(n) || n <= 0 || n > 65535) {
          throw new Error(`--port must be a valid port number, got: ${next}`);
        }
        args.port = n;
        break;
      }
      case "--help":
      case "-h":
        args.help = true;
        args.command = "help";
        break;
      case "version":
      case "--version":
      case "-v":
        args.command = "version";
        break;
      case "doctor":
        args.command = "doctor";
        break;
      default:
        if (a?.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // bin/baklava.ts → ../package.json (works whether bundled or run via tsx/ts-node).
  const pkgPath = resolve(here, "..", "package.json");
  if (!existsSync(pkgPath)) return "0.0.0-unknown";
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0-unknown";
}

function runDoctor(): void {
  const version = readPackageVersion();
  console.log(`baklava v${version}`);
  console.log(`node ${process.version} on ${process.platform}/${process.arch}`);
  console.log(`baklava home: ${BAKLAVA_DIR}`);
  console.log(`available plugins: ${listPlugins().join(", ")}`);

  const aiKey = getAnthropicApiKey();
  if (aiKey) {
    const masked = aiKey.length > 12 ? `${aiKey.slice(0, 7)}...${aiKey.slice(-4)}` : "***";
    console.log(`anthropic key: configured (${masked})`);
  } else {
    console.log("anthropic key: NOT SET — set ANTHROPIC_API_KEY or visit Settings");
  }

  try {
    const file = loadConnections();
    if (file.connections.length === 0) {
      console.log("connections: none — try `baklava --demo` for a tour");
    } else {
      console.log(`connections (${file.connections.length}):`);
      for (const c of file.connections) {
        console.log(`  - ${c.name} (${c.plugin})`);
      }
    }
  } catch (err) {
    if (isBaklavaError((err as { error?: unknown }).error)) {
      const e = (err as { error: { code: string; what: string; fix: string } }).error;
      console.log(`connections: ERROR (${e.code}): ${e.what}`);
      console.log(`  fix: ${e.fix}`);
    } else {
      console.log(`connections: error — ${(err as Error).message}`);
    }
  }

  // Touch the instance token so it exists for the next API call.
  try {
    getOrCreateInstanceToken();
    console.log("instance.key: ok");
  } catch (err) {
    console.log(`instance.key: error — ${(err as Error).message}`);
  }
}

function startServer(port: number): never {
  const here = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(here, "..");

  // Resolve the next bin from this package's node_modules.
  let nextBin: string;
  try {
    nextBin = require.resolve("next/dist/bin/next", { paths: [projectRoot] });
  } catch (err) {
    console.error(
      `Could not find Next.js. Try reinstalling: npm install (in ${projectRoot}).`
    );
    throw err;
  }

  console.log(`baklava → http://localhost:${port}  (127.0.0.1 only)`);
  const child = spawn(
    process.execPath,
    [nextBin, "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      stdio: "inherit",
      cwd: projectRoot,
      env: { ...process.env, BAKLAVA_PORT: String(port) },
    }
  );
  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  // Block here forever — the child holds the process alive.
  return new Promise<never>(() => {}) as never;
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    console.error("Run `baklava --help` for usage.");
    process.exit(2);
  }

  if (args.help || args.command === "help") {
    console.log(HELP.trim());
    return;
  }

  if (args.command === "version") {
    console.log(readPackageVersion());
    return;
  }

  if (args.command === "doctor") {
    runDoctor();
    return;
  }

  // start
  if (args.demo) {
    console.log("seeding demo SQLite databases...");
    const result = seedDemo();
    console.log(
      `  ${result.appPath} (${result.rows.users} users) ${result.reseeded ? "[seeded]" : "[exists]"}`
    );
    console.log(
      `  ${result.eventsPath} (${result.rows.orders} orders) ${
        result.reseeded ? "[seeded]" : "[exists]"
      }`
    );
    console.log("connections written to ~/.baklava/connections.json");
  }

  await startServer(args.port);
}

main().catch((err) => {
  console.error((err as Error).message ?? String(err));
  process.exit(1);
});
