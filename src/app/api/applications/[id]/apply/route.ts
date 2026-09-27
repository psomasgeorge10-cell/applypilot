/**
 * /api/applications/[id]/apply - approve an application for automatic
 * submission. The response returns immediately with status `applying`; the
 * browser submitter runs after the response is sent and the UI polls for the
 * outcome.
 */

import { after, NextResponse } from "next/server";
import { jsonError, parseId, requireSession, route } from "@/server/api";
import { getApplication, updateApplication } from "@/server/repo";
import { submitApplication } from "@/server/submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const APPROVABLE = new Set(["suggested", "needs_input", "failed"]);

export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const user = await requireSession();
  const id = parseId((await context.params).id);
  if (!id) return jsonError(404, "Application not found");

  const application = await getApplication(user.id, id);
  if (!application) return jsonError(404, "Application not found");
  if (!application.canAutoApply) {
    return jsonError(422, "This board does not support auto-apply - open the posting and apply there");
  }
  if (!APPROVABLE.has(application.status)) {
    return jsonError(409, `Cannot apply to an application that is ${application.status}`);
  }

  const updated = await updateApplication(user.id, id, { status: "applying", lastError: null });
  after(async () => {
    try {
      await submitApplication(user.id, id);
    } catch (error) {
      console.error(`[apply] submitting application ${id} failed`, error);
      await updateApplication(user.id, id, { status: "failed", lastError: "Unexpected error while submitting" });
    }
  });
  return NextResponse.json(updated, { status: 202 });
});
