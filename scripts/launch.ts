/**
 * One-command local launch:  npm run launch
 *
 *   1. creates .env.local on first run and asks for your Anthropic API key
 *   2. finds Chrome/Chromium for auto-apply
 *   3. prepares the database (and the demo account)
 *   4. starts the app and opens it in your browser
 *
 * Safe to run every time: steps that are already done are skipped.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const ENV_FILE = ".env.local";
const PORT = process.env.PORT ?? "3000";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const CHROME_CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

function step(message: string) {
  console.log(`\n\x1b[1m▸ ${message}\x1b[0m`);
}

/** Reads KEY=value from the env file, ignoring commented-out lines. */
function readEnv(key: string): string | undefined {
  if (!existsSync(ENV_FILE)) return undefined;
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(ENV_FILE, "utf8"));
  return match?.[1].trim() || undefined;
}

/** Sets KEY=value, replacing a commented-out `# KEY=` placeholder when there is one. */
function writeEnv(key: string, value: string) {
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const line = `${key}=${value}`;
  const placeholder = new RegExp(`^#?\\s*${key}=.*$`, "m");
  const next = placeholder.test(current) ? current.replace(placeholder, line) : `${current.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_FILE, next);
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n${command} ${args.join(" ")} failed.`);
    process.exit(result.status ?? 1);
  }
}

function openBrowser(url: string) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
}

async function main() {
  step("Configuration");
  if (!existsSync(ENV_FILE)) {
    copyFileSync(".env.example", ENV_FILE);
    console.log(`Created ${ENV_FILE}.`);
  }

  if (!readEnv("ANTHROPIC_API_KEY") && !process.env.ANTHROPIC_API_KEY) {
    if (process.stdin.isTTY) {
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
  } else {
    console.log("Anthropic API key: found.");
  }

  if (!readEnv("CHROMIUM_PATH") && !process.env.CHROMIUM_PATH) {
    const chrome = (CHROME_CANDIDATES[process.platform] ?? []).find((path) => existsSync(path));
    if (chrome) {
      writeEnv("CHROMIUM_PATH", chrome);
      console.log(`Browser for auto-apply: ${chrome}`);
    } else {
      console.log("No Chrome/Chromium found - auto-apply is off until you install Chrome or set CHROMIUM_PATH.");
    }
  }

  step("Database");
  run(npm, ["run", "--silent", "db:setup"]);

  step(`Starting ApplyPilot on http://localhost:${PORT}`);
  const url = `http://localhost:${PORT}`;
  const server = spawn(npx, ["next", "dev", "-p", PORT], { stdio: ["inherit", "pipe", "inherit"] });
  let opened = false;
  server.stdout.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    if (!opened && /ready|Local:/i.test(chunk.toString())) {
      opened = true;
      openBrowser(url);
      console.log(`\nOpen ${url} if your browser did not open. Press Ctrl+C to stop.\n`);
    }
  });
  server.on("exit", (code) => process.exit(code ?? 0));
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => server.kill(signal));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
