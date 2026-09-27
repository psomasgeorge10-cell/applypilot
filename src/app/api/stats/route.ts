/** /api/stats - headline counts for the dashboard. */

import { NextResponse } from "next/server";
import { requireSession, route } from "@/server/api";
import { getStats } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireSession();
  return NextResponse.json(await getStats(user.id));
});
