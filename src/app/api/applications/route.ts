/** /api/applications?view=review|active|done|all - the user's applications. */

import { NextResponse, type NextRequest } from "next/server";
import { requireSession, route, validationError } from "@/server/api";
import { listApplications } from "@/server/repo";
import { applicationViewSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (request: NextRequest) => {
  const user = await requireSession();
  const view = applicationViewSchema.safeParse(request.nextUrl.searchParams.get("view") ?? undefined);
  if (!view.success) return validationError(view.error);
  return NextResponse.json(await listApplications(user.id, view.data));
});
