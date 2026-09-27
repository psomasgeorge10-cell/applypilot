/**
 * One-command launch:  npm run launch
 * (or double-click start-windows.cmd / start-mac.command, or the desktop icon)
 *
 *   1. installs dependencies when they are missing or out of date
 *   2. if ApplyPilot is already running, just opens it in the browser
 *   3. creates .env.local on first run and asks for your Anthropic API key
 *   4. finds Chrome, Chromium or Edge for auto-apply
 *   5. prepares the database (and the demo account)
 *   6. adds an ApplyPilot icon to the desktop (first run only)
 *   7. starts the app and opens it in the browser
 *
 * Plain JavaScript with only Node built-ins on purpose: it has to run before
 * `npm install` has installed anything.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createShortcut } from "./shortcut.mjs";

// Everything below works relative to the project, wherever this is started from.
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

const ENV_FILE = ".env.local";
const DEPS_STAMP = path.join("node_modules", ".applypilot-deps");
const SHORTCUT_MARKER = ".applypilot-shortcut";
const BASE_PORT = Number(process.env.PORT ?? 3000);
const PORTS = Array.from({ length: 10 }, (_, index) => BASE_PORT + index);
const isWindows = process.platform === "win32";

const CHROME_CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"],
  win32: [
    path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    // Present on every Windows 10/11 machine, and Chromium-based.
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

function step(message) {
  console.log(`\n\x1b[1m▸ ${message}\x1b[0m`);
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Processes                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Runs npm. On Windows npm is a .cmd script, which Node only starts through a
 * shell; the arguments here are fixed words, so joining them is safe.
 */
function npm(args) {
  const result = isWindows
    ? spawnSync(["npm", ...args].join(" "), { stdio: "inherit", shell: true })
    : spawnSync("npm", args, { stdio: "inherit" });
  if (result.status !== 0) fail(`npm ${args.join(" ")} failed.`);
}

/** Path to a package's CLI entry point, run with this same Node binary - no shell involved. */
function binPath(pkg, name) {
  const manifest = JSON.parse(readFileSync(path.join("node_modules", pkg, "package.json"), "utf8"));
  return path.join("node_modules", pkg, typeof manifest.bin === "string" ? manifest.bin : manifest.bin[name]);
}

function openBrowser(url) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : isWindows
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                       */
/* -------------------------------------------------------------------------- */

function lockHash() {
  return createHash("sha256").update(readFileSync("package-lock.json")).digest("hex");
}

function ensureDependencies() {
  const ready =
    existsSync(path.join("node_modules", "next", "package.json")) &&
    existsSync(DEPS_STAMP) &&
    readFileSync(DEPS_STAMP, "utf8") === lockHash();
  if (ready) return;

  step("Installing dependencies (a few minutes the first time)");
  npm(["install", "--no-audit", "--no-fund"]);
  writeFileSync(DEPS_STAMP, lockHash());
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

/** The URL of an ApplyPilot server already running on this machine, if any. */
async function findRunningInstance() {
  for (const port of PORTS) {
    if (!(await portOpen(port))) continue;
    try {
      // Generous timeout: the dev server may compile the page on first request.
      const response = await fetch(`http://127.0.0.1:${port}/login`, { signal: AbortSignal.timeout(20_000) });
      if (response.ok && (await response.text()).includes("ApplyPilot")) return `http://localhost:${port}`;
    } catch {
      // Something else is listening there.
    }
  }
  return null;
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port);
  });
}

/** Reads KEY=value from the env file, ignoring commented-out lines. */
function readEnv(key) {
  if (!existsSync(ENV_FILE)) return undefined;
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(ENV_FILE, "utf8"));
  return match?.[1].trim() || undefined;
}

/** Sets KEY=value, replacing a commented-out `# KEY=` placeholder when there is one. */
function writeEnv(key, value) {
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const line = `${key}=${value}`;
  const placeholder = new RegExp(`^#?\\s*${key}=.*$`, "m");
  writeFileSync(ENV_FILE, placeholder.test(current) ? current.replace(placeholder, line) : `${current.trimEnd()}\n${line}\n`);
}

async function configure() {
  step("Configuration");
  if (!existsSync(ENV_FILE)) {
    copyFileSync(".env.example", ENV_FILE);
    console.log(`Created ${ENV_FILE}.`);
  }

  if (readEnv("ANTHROPIC_API_KEY") || process.env.ANTHROPIC_API_KEY) {
    console.log("Anthropic API key: found.");
  } else if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const key = (
      await rl.question("Paste your Anthropic API key (https://console.anthropic.com), or press Enter to skip: ")
    ).trim();
    rl.close();
    if (key) {
      writeEnv("ANTHROPIC_API_KEY", key);
      console.log("Saved.");
    } else {
      console.log("Skipped - you can browse the demo, but AI features stay off until you add a key.");
    }
  } else {
    console.log(`No ANTHROPIC_API_KEY yet - add it to ${ENV_FILE} to turn on AI features.`);
  }

  if (!readEnv("CHROMIUM_PATH") && !process.env.CHROMIUM_PATH) {
    const browser = (CHROME_CANDIDATES[process.platform] ?? []).find((file) => existsSync(file));
    if (browser) {
      writeEnv("CHROMIUM_PATH", browser);
      console.log(`Browser for auto-apply: ${browser}`);
    } else {
      console.log("No Chrome, Chromium or Edge found - auto-apply stays off until you install one or set CHROMIUM_PATH.");
    }
  }
}

function prepareDatabase() {
  step("Database");
  const result = spawnSync(process.execPath, [binPath("tsx", "tsx"), "scripts/setup.ts"], { stdio: "inherit" });
  if (result.status !== 0) fail("Setting up the database failed.");
}

/** First run only: the marker remembers it, so an icon the user deleted stays deleted. */
function ensureShortcut() {
  // APPLYPILOT_NO_SHORTCUT=1 skips this, e.g. on servers and in CI.
  if (existsSync(SHORTCUT_MARKER) || process.env.APPLYPILOT_NO_SHORTCUT) return;
  step("Desktop icon");
  try {
    const created = createShortcut(process.cwd());
    writeFileSync(SHORTCUT_MARKER, `${created.join("\n")}\n`);
    console.log(`Added an ApplyPilot icon - double-click it next time:\n${created.map((file) => `  ${file}`).join("\n")}`);
  } catch (error) {
    console.log(`Could not add a desktop icon (${error instanceof Error ? error.message : error}).`);
    console.log("You can still start ApplyPilot with `npm run launch`, or try again with `npm run shortcut`.");
  }
}

async function startServer() {
  let port = null;
  for (const candidate of PORTS) {
    if (await portFree(candidate)) {
      port = candidate;
      break;
    }
  }
  if (port === null) fail(`Ports ${PORTS[0]}-${PORTS.at(-1)} are all in use. Set PORT to a free one and try again.`);

  step(`Starting ApplyPilot on http://localhost:${port}`);
  const server = spawn(process.execPath, [binPath("next", "next"), "dev", "-p", String(port)], {
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });

  let output = "";
  let opened = false;
  server.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    if (opened) return;
    output += chunk.toString();
    if (/Ready/i.test(output)) {
      opened = true;
      const url = /Local:\s+(http\S+)/.exec(output)?.[1] ?? `http://localhost:${port}`;
      openBrowser(url);
      console.log(
        `\n\x1b[1mApplyPilot is running at ${url}\x1b[0m\n` +
          "Keep this window open while you use it - close it (or press Ctrl+C) to stop ApplyPilot.\n",
      );
    }
  });
  server.on("exit", (code) => process.exit(code ?? 0));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.kill(signal));
  }
}

async function main() {
  ensureDependencies();

  const running = await findRunningInstance();
  if (running) {
    console.log(`ApplyPilot is already running - opening ${running}`);
    openBrowser(running);
    return;
  }

  await configure();
  prepareDatabase();
  ensureShortcut();
  await startServer();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
