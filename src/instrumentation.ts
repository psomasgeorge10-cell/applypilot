/**
 * Next.js start-up hook. When SCHEDULER_INTERVAL_MINUTES is set, the web
 * server also runs every user's job search on that interval, so a hosted
 * deployment needs no separate worker process.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const minutes = Number(process.env.SCHEDULER_INTERVAL_MINUTES ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return;

  const { startScheduler } = await import("./server/scheduler");
  startScheduler(minutes);
}
