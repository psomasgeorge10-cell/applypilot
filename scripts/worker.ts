/**
 * Background worker: runs every user's pipeline on an interval.
 *
 *   npm run worker                 loop forever (WORKER_INTERVAL_MINUTES, default 60)
 *   npm run worker -- --once       one pass, then exit (for cron or a scheduler)
 *
 * The web server can do the same itself (SCHEDULER_INTERVAL_MINUTES); use this
 * when you want job searches in their own process. The embedded PGlite
 * database allows one process at a time, so alongside the web app this needs
 * DATABASE_URL pointing at a real Postgres server.
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

async function main() {
  // Imported after dotenv so modules read the configured environment.
  const { runAllPipelines, startScheduler } = await import("../src/server/scheduler");

  await runAllPipelines();
  if (process.argv.includes("--once")) {
    const { getDb } = await import("../src/server/db");
    await (await getDb()).close();
    return;
  }
  startScheduler(Number(process.env.WORKER_INTERVAL_MINUTES ?? 60));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
