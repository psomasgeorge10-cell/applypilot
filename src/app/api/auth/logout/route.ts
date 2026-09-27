/** /api/auth/logout - clears the session cookie. */

import { NextResponse } from "next/server";
import { endSession } from "@/server/auth";
import { route } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async () => {
  await endSession();
  return new NextResponse(null, { status: 204 });
});
