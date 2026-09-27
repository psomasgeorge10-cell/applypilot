/**
 * The job-hunting pipeline for one user:
 *
 *   sync boards -> pre-filter -> score -> write cover letters -> queue -> submit
 *
 * Every posting a user has seen gets exactly one `applications` row, whatever
 * its fate (skipped, suggested, auto-approved), so it is never evaluated - or
 * paid for - twice.
 */

import { AUTO_APPLY_ATS, type PipelineReport } from "@/lib/types";
import { fetchBoard } from "./ats";
import { getAi, type AiService, type JobForAi } from "./ai";
import { prefilter } from "./filter";
import {
  claimApproved,
  countAppliedToday,
  createApplication,
  getUserContext,
  listSources,
  recordSourceSync,
  unscoredJobs,
  upsertJobs,
  type JobRow,
} from "./repo";
import { submitApplication, type SubmitDeps } from "./submit";

export interface PipelineDeps extends SubmitDeps {
  fetchImpl?: typeof fetch;
  /** Maximum postings scored per run, to bound cost and run time. */
  maxScored?: number;
  /** Skip syncing boards (used when re-running just the submit step). */
  skipSync?: boolean;
}

const DEFAULT_MAX_SCORED = Number(process.env.PIPELINE_MAX_SCORED ?? 40);
const SCORING_CONCURRENCY = 4;

export class PipelineError extends Error {}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

function forAi(job: JobRow): JobForAi {
  return {
    company: job.company,
    title: job.title,
    location: job.location,
    remote: job.remote,
    description: job.description,
  };
}

// One run per user at a time; a second request while one is in flight joins it.
const running = new Map<number, Promise<PipelineReport>>();

export function runPipeline(userId: number, deps: PipelineDeps = {}): Promise<PipelineReport> {
  const existing = running.get(userId);
  if (existing) return existing;
  const run = execute(userId, deps).finally(() => running.delete(userId));
  running.set(userId, run);
  return run;
}

async function execute(userId: number, deps: PipelineDeps): Promise<PipelineReport> {
  const report: PipelineReport = {
    sourcesSynced: 0,
    sourceErrors: [],
    newJobs: 0,
    filteredOut: 0,
    scored: 0,
    suggested: 0,
    autoApproved: 0,
    submitted: 0,
    submitFailures: 0,
    needsInput: 0,
  };

  const ctx = await getUserContext(userId, deps.db);
  if (!ctx.profile) throw new PipelineError("Upload your resume first so there is something to match against");

  /* 1. Sync every watched board. One broken board never stops the others. */
  if (!deps.skipSync) {
    for (const source of await listSources(userId, deps.db)) {
      try {
        const jobs = await fetchBoard(source.ats, source.boardToken, deps.fetchImpl);
        report.newJobs += await upsertJobs(source.ats, source.boardToken, source.company, jobs, deps.db);
        await recordSourceSync(source.id, null, deps.db);
        report.sourcesSynced += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordSourceSync(source.id, message, deps.db);
        report.sourceErrors.push({ company: source.company, error: message });
      }
    }
  }

  /* 2. Pre-filter and score what has not been evaluated yet. */
  const candidates = await unscoredJobs(userId, deps.maxScored ?? DEFAULT_MAX_SCORED, deps.db);
  const toScore: JobRow[] = [];
  for (const job of candidates) {
    const verdict = prefilter(job, ctx.preferences);
    if (verdict.ok) {
      toScore.push(job);
    } else {
      report.filteredOut += 1;
      await createApplication(
        {
          userId,
          jobId: job.id,
          status: "skipped",
          match: { score: 0, summary: verdict.reason, strengths: [], gaps: [] },
        },
        deps.db,
      );
    }
  }

  if (toScore.length > 0) {
    const ai: AiService = deps.ai ?? getAi();
    const profile = ctx.profile;
    const { settings, preferences } = ctx;

    await mapLimit(toScore, SCORING_CONCURRENCY, async (job) => {
      let match;
      try {
        match = await ai.scoreJob(profile, preferences, forAi(job));
      } catch (error) {
        // Leave it unscored so the next run retries it.
        console.error(`[pipeline] scoring job ${job.id} failed`, error);
        return;
      }
      report.scored += 1;

      if (match.score < settings.reviewMinScore) {
        await createApplication({ userId, jobId: job.id, status: "skipped", match }, deps.db);
        return;
      }

      let coverLetter = "";
      try {
        coverLetter = await ai.writeCoverLetter(profile, preferences, forAi(job), match);
      } catch (error) {
        // Still worth showing; the user can regenerate the letter from the queue.
        console.error(`[pipeline] cover letter for job ${job.id} failed`, error);
      }

      const autoApprove =
        settings.autoApply &&
        match.score >= settings.autoApplyMinScore &&
        AUTO_APPLY_ATS.includes(job.ats) &&
        coverLetter !== "";

      await createApplication(
        {
          userId,
          jobId: job.id,
          status: autoApprove ? "approved" : "suggested",
          match,
          coverLetter,
          autoApproved: autoApprove,
        },
        deps.db,
      );
      if (autoApprove) report.autoApproved += 1;
      else report.suggested += 1;
    });
  }

  /* 3. Submit what is approved, within the daily limit. */
  const remaining = ctx.settings.dailyApplyLimit - (await countAppliedToday(userId, deps.db));
  for (const applicationId of await claimApproved(userId, remaining, deps.db)) {
    const result = await submitApplication(userId, applicationId, deps);
    if (result === "applied") report.submitted += 1;
    else if (result === "needs_input") report.needsInput += 1;
    else report.submitFailures += 1;
  }

  return report;
}
