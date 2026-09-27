/**
 * Background worker: runs every user's pipeline on an interval.
 *
 *   npm run worker                 loop forever (WORKER_INTERVAL_MINUTES, default 60)
 *   npm run worker -- --once       one pass, then exit (for cron or a scheduler)
 *
 * Run it next to the web server against the same database. Note that the
 * embedded PGlite database allows one process at a time, so the worker needs
 * DATABASE_URL pointing at a real Postgres server whenever the web app is
 * running too.
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

async function pass() {
  // Imported after dotenv so modules read the configured environment.
  const { listPipelineUsers } = await import("../src/server/repo");
  const { runPipeline } = await import("../src/server/pipeline");

  const users = await listPipelineUsers();
  console.log(`[worker] ${new Date().toISOString()} - running ${users.length} pipeline(s)`);
  for (const userId of users) {
    try {
      const report = await runPipeline(userId);
      console.log(`[worker] user ${userId}`, JSON.stringify(report));
    } catch (error) {
      console.error(`[worker] user ${userId} failed:`, error instanceof Error ? error.message : error);
    }
  }
}

async function main() {
  const once = process.argv.includes("--once");
  const minutes = Math.max(5, Number(process.env.WORKER_INTERVAL_MINUTES ?? 60));

  await pass();
  if (once) {
    const { getDb } = await import("../src/server/db");
    await (await getDb()).close();
    return;
  }

  console.log(`[worker] next pass in ${minutes} minutes`);
  setInterval(() => {
    pass().catch((error) => console.error("[worker] pass failed", error));
  }, minutes * 60_000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
