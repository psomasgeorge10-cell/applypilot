/**
 * Submitting one application end to end: open the form, decide every field,
 * and either submit it or hand it back to the user.
 *
 * Nothing is submitted unless APPLY_LIVE=true. Without it the submitter does
 * everything except the final click, which makes it safe to try the whole
 * flow - including against real postings - before trusting it.
 */

import { getAi, type AiService } from "../ai";
import {
  getApplication,
  getResumeFile,
  getUserContext,
  updateApplication,
} from "../repo";
import type { Database } from "../db";
import { BrowserUnavailableError, launchDriver, type FormDriver, type UploadFile } from "./browser";
import { coerce, planFill, unansweredRequired, type FieldValue } from "./fields";
import type { PendingQuestion } from "@/lib/types";

export type SubmitResult = "applied" | "needs_input" | "failed";

export interface SubmitDeps {
  ai?: AiService;
  driver?: () => Promise<FormDriver>;
  live?: boolean;
  db?: Database;
}

export function liveSubmissionsEnabled(): boolean {
  return process.env.APPLY_LIVE === "true";
}

function textFile(name: string, content: string): UploadFile {
  return { name, mimeType: "text/plain", buffer: Buffer.from(content, "utf8") };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "candidate";
}

/**
 * Submits an application the caller has already moved to `applying`
 * (see `claimApproved`). Always leaves it in a terminal or user-facing state.
 */
export async function submitApplication(
  userId: number,
  applicationId: number,
  deps: SubmitDeps = {},
): Promise<SubmitResult> {
  const application = await getApplication(userId, applicationId, deps.db);
  if (!application) return "failed";

  const fail = async (message: string): Promise<SubmitResult> => {
    await updateApplication(userId, applicationId, { status: "failed", lastError: message }, deps.db);
    return "failed";
  };

  if (!application.canAutoApply) {
    return fail(`Auto-apply is not supported for ${application.job.ats} postings - apply on the company site`);
  }

  const ctx = await getUserContext(userId, deps.db);
  if (!ctx.profile) return fail("Upload your resume before applying");

  const resumeFile = await getResumeFile(userId, deps.db);
  const candidate = slug(ctx.profile.fullName);
  const files: Record<"resume" | "cover_letter", UploadFile | null> = {
    resume: resumeFile
      ? { name: resumeFile.filename, mimeType: resumeFile.mime, buffer: Buffer.from(resumeFile.data) }
      : null,
    cover_letter: application.coverLetter
      ? textFile(`${candidate}-cover-letter.txt`, application.coverLetter)
      : null,
  };

  let driver: FormDriver;
  try {
    driver = await (deps.driver ?? launchDriver)();
  } catch (error) {
    if (error instanceof BrowserUnavailableError) return fail(`Auto-apply unavailable: ${error.message}`);
    throw error;
  }

  try {
    await driver.open(application.job.applyUrl);
    const fields = await driver.scrape();
    if (fields.length === 0) return await fail("Could not find an application form on the page");

    const fillContext = {
      profile: ctx.profile,
      answers: ctx.answers,
      coverLetter: application.coverLetter,
      extraAnswers: application.extraAnswers,
      hasResumeFile: Boolean(files.resume),
    };
    const plan = planFill(fields, fillContext);
    const values = new Map<string, FieldValue>(plan.values);

    if (plan.forAi.length > 0) {
      const ai = deps.ai ?? getAi();
      const answers = await ai.answerFields(
        ctx.profile,
        ctx.answers,
        application.job,
        application.coverLetter,
        plan.forAi,
      );
      for (const { key, answer } of answers) {
        const field = plan.forAi.find((candidateField) => candidateField.key === key);
        if (!field || !answer) continue;
        const value = coerce(field, answer);
        if (value) values.set(key, value);
      }
    }

    const missing = unansweredRequired(fields, values);
    if (missing.length > 0) {
      const questions: PendingQuestion[] = missing.map((field) => ({
        key: field.key,
        label: field.isFile ? `${field.label} (file upload - apply manually)` : field.label,
        options: field.options,
      }));
      await updateApplication(
        userId,
        applicationId,
        { status: "needs_input", pendingQuestions: questions, lastError: null },
        deps.db,
      );
      return "needs_input";
    }

    await driver.fill(values, files);

    const captcha = await driver.blockingCaptcha();
    if (captcha) return await fail(`${captcha} - open the posting and apply manually`);

    const live = deps.live ?? liveSubmissionsEnabled();
    if (!live) {
      return await fail(
        `Dry run: all ${fields.length} fields were filled but the form was not submitted. Set APPLY_LIVE=true to submit for real.`,
      );
    }

    const outcome = await driver.submit();
    if (!outcome.ok) return await fail(outcome.message);

    await updateApplication(
      userId,
      applicationId,
      { status: "applied", appliedAt: "now", lastError: null, pendingQuestions: [] },
      deps.db,
    );
    return "applied";
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return fail(`Submission error: ${message}`);
  } finally {
    await driver.close();
  }
}
