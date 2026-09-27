/** /api/applications/[id]/cover-letter - write a fresh cover letter for this posting. */

import { NextResponse } from "next/server";
import { jsonError, parseId, requireSession, route } from "@/server/api";
import { getAi } from "@/server/ai";
import { getApplication, getUserContext, updateApplication } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const user = await requireSession();
  const id = parseId((await context.params).id);
  if (!id) return jsonError(404, "Application not found");

  const application = await getApplication(user.id, id);
  if (!application) return jsonError(404, "Application not found");
  const ctx = await getUserContext(user.id);
  if (!ctx.profile) return jsonError(422, "Upload your resume first");

  const coverLetter = await getAi().writeCoverLetter(ctx.profile, ctx.preferences, application.job, {
    score: application.score,
    summary: application.matchSummary,
    strengths: application.strengths,
    gaps: application.gaps,
  });
  return NextResponse.json(await updateApplication(user.id, id, { coverLetter }));
});
