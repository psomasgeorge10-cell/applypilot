/**
 * Turning an uploaded resume into a structured profile.
 *
 * PDFs go to Claude as-is (it reads layout, columns and tables better than a
 * text extractor). Word documents are converted to text first, and plain text
 * is passed through.
 */

import { getAi, type ResumeInput } from "./ai";
import type { CandidateProfile } from "@/lib/types";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class UnsupportedResumeError extends Error {}

export type ResumeKind = "pdf" | "docx" | "text";

export function resumeKind(filename: string, mime: string): ResumeKind | null {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (mime === DOCX_MIME || extension === "docx") return "docx";
  if (mime.startsWith("text/") || extension === "txt" || extension === "md") return "text";
  return null;
}

export function canonicalMime(kind: ResumeKind): string {
  return kind === "pdf" ? "application/pdf" : kind === "docx" ? DOCX_MIME : "text/plain";
}

export async function extractResume(
  bytes: Uint8Array,
  kind: ResumeKind,
): Promise<{ text: string; profile: CandidateProfile }> {
  let input: ResumeInput;
  let text = "";

  if (kind === "pdf") {
    input = { kind: "pdf", base64: Buffer.from(bytes).toString("base64") };
  } else if (kind === "docx") {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value.trim();
    input = { kind: "text", text };
  } else {
    text = new TextDecoder().decode(bytes).trim();
    input = { kind: "text", text };
  }

  if (input.kind === "text" && text.length < 50) {
    throw new UnsupportedResumeError("That file does not contain enough readable text");
  }

  return { text, profile: await getAi().parseResume(input) };
}
