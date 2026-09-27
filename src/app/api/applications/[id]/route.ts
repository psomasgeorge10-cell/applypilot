/**
 * /api/applications/[id]
 *
 *   PATCH - edit the cover letter, answer pending questions, or move the
 *           application along (skip it, mark it applied, record an interview).
 */

import { NextResponse, type NextRequest } from "next/server";
import { jsonError, parseId, requireSession, route, validationError } from "@/server/api";
import { getApplication, updateApplication } from "@/server/repo";
import { applicationPatchSchema } from "@/lib/validation";
import type { ApplicationStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Statuses a user may set by hand. `approved`/`applying` go through the apply
 * endpoint, which also enforces that the board supports auto-apply.
 */
const USER_SETTABLE: ApplicationStatus[] = ["suggested", "skipped", "applied", "interview", "rejected", "offer"];

export const PATCH = route(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const user = await requireSession();
  const id = parseId((await context.params).id);
  if (!id) return jsonError(404, "Application not found");

  const body = await request.json().catch(() => null);
  const parsed = applicationPatchSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const current = await getApplication(user.id, id);
  if (!current) return jsonError(404, "Application not found");

  const { status, ...rest } = parsed.data;
  if (status && !USER_SETTABLE.includes(status)) {
    return jsonError(422, "Validation failed", { status: "That status cannot be set directly" });
  }
  if (current.status === "applying") {
    return jsonError(409, "This application is being submitted right now");
  }

  const updated = await updateApplication(user.id, id, {
    ...rest,
    status,
    // A manual "I applied" records when, so it counts toward the daily total.
    appliedAt: status === "applied" && !current.appliedAt ? "now" : undefined,
  });
  return NextResponse.json(updated);
});
