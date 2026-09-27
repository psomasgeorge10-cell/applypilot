/**
 * Runs every user's pipeline on an interval.
 *
 * Used two ways: inside the web server (set SCHEDULER_INTERVAL_MINUTES, see
 * src/instrumentation.ts), which keeps a hosted deployment to one service, or
 * as a separate process via `npm run worker`.
 */

import { runPipeline } from "./pipeline";
import { listPipelineUsers } from "./repo";

export async function runAllPipelines(): Promise<void> {
  const users = await listPipelineUsers();
  console.log(`[scheduler] ${new Date().toISOString()} - running ${users.length} pipeline(s)`);
  for (const userId of users) {
    try {
      const report = await runPipeline(userId);
      console.log(`[scheduler] user ${userId}`, JSON.stringify(report));
    } catch (error) {
      console.error(`[scheduler] user ${userId} failed:`, error instanceof Error ? error.message : error);
    }
  }
}

/** Starts the loop. The first pass waits one interval so a deploy does not trigger a burst of work. */
export function startScheduler(minutes: number): NodeJS.Timeout {
  const interval = Math.max(5, minutes);
  console.log(`[scheduler] running pipelines every ${interval} minutes`);
  let busy = false;
  return setInterval(() => {
    if (busy) return;
    busy = true;
    runAllPipelines()
      .catch((error) => console.error("[scheduler] pass failed", error))
      .finally(() => {
        busy = false;
      });
  }, interval * 60_000);
}
