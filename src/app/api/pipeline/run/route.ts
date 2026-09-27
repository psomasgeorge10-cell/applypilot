/**
 * /api/pipeline/run - sync boards, score new postings and submit approved
 * applications for the signed-in user, now. The background worker
 * (`npm run worker`) does the same on a schedule.
 */

import { NextResponse } from "next/server";
import { requireSession, route } from "@/server/api";
import { runPipeline } from "@/server/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = route(async () => {
  const user = await requireSession();
  return NextResponse.json(await runPipeline(user.id));
});
