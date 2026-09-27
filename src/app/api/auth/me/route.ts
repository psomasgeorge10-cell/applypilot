/** /api/auth/me - who the current session belongs to. */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { jsonError, route } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await getSessionUser();
  return user ? NextResponse.json(user) : jsonError(401, "Authentication required");
});
