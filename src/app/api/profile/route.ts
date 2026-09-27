/**
 * /api/profile
 *
 *   GET   - the signed-in user's profile, preferences, saved answers and settings
 *   PATCH - update any of those sections
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireSession, route, validationError } from "@/server/api";
import { getProfileView, updateProfile } from "@/server/repo";
import { profilePatchSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireSession();
  return NextResponse.json(await getProfileView(user.id));
});

export const PATCH = route(async (request: NextRequest) => {
  const user = await requireSession();
  const body = await request.json().catch(() => null);
  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  await updateProfile(user.id, parsed.data);
  return NextResponse.json(await getProfileView(user.id));
});
