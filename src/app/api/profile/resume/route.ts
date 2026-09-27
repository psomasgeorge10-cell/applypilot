/** /api/profile/resume - upload a resume (multipart field "file") and extract the profile from it. */

import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireSession, route } from "@/server/api";
import { getProfileView, saveResume } from "@/server/repo";
import {
  MAX_RESUME_BYTES,
  UnsupportedResumeError,
  canonicalMime,
  extractResume,
  resumeKind,
} from "@/server/resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reading a multi-page PDF with the model can take a while.
export const maxDuration = 120;

export const POST = route(async (request: NextRequest) => {
  const user = await requireSession();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(422, "Choose a file to upload");
  if (file.size === 0) return jsonError(422, "That file is empty");
  if (file.size > MAX_RESUME_BYTES) return jsonError(422, "Resumes must be 5 MB or smaller");

  const kind = resumeKind(file.name, file.type);
  if (!kind) return jsonError(422, "Upload a PDF, Word (.docx) or plain-text resume");

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const { text, profile } = await extractResume(bytes, kind);
    await saveResume(user.id, {
      file: bytes,
      filename: file.name,
      mime: canonicalMime(kind),
      text,
      profile,
    });
  } catch (error) {
    if (error instanceof UnsupportedResumeError) return jsonError(422, error.message);
    throw error;
  }

  return NextResponse.json(await getProfileView(user.id));
});
