"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { scoreTone, timeAgo } from "@/lib/format";
import {
  ATS_LABELS,
  STATUS_LABELS,
  TRACKING_STATUSES,
  type Application,
  type ApplicationStatus,
} from "@/lib/types";
import type { ApplicationPatch } from "@/lib/validation";
import type { Toast } from "./Toaster";
import { ExternalIcon, SparkIcon } from "./icons";
import { Button, Card, controlClass, cx } from "./ui";

type Notify = (tone: Toast["tone"], message: string) => void;

const STATUS_TONES: Partial<Record<ApplicationStatus, string>> = {
  suggested: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  approved: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  applying: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  needs_input: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  applied: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  interview: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  offer: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

export function ApplicationCard({
  application,
  onChange,
  onRemoved,
  notify,
}: {
  application: Application;
  onChange: (updated: Application) => void;
  onRemoved: () => void;
  notify: Notify;
}) {
  const { job, status } = application;
  const [expanded, setExpanded] = useState(status === "needs_input");
  const [letter, setLetter] = useState(application.coverLetter);
  const [answers, setAnswers] = useState<Record<string, string>>(application.extraAnswers);
  const [busy, setBusy] = useState<string | null>(null);

  const reviewable = ["suggested", "needs_input", "failed"].includes(status);
  const tracked = (TRACKING_STATUSES as readonly string[]).includes(status);
  const letterDirty = letter !== application.coverLetter;

  async function act(label: string, action: () => Promise<Application | void>, success?: string) {
    setBusy(label);
    try {
      const result = await action();
      if (result) {
        onChange(result);
        setLetter(result.coverLetter);
      }
      if (success) notify("success", success);
    } catch (error) {
      notify("error", error instanceof ApiError ? error.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const patch = (body: ApplicationPatch) => api.updateApplication(application.id, body);

  async function approve() {
    await act("apply", async () => {
      // Save edits first so the submitter uses what the user sees.
      const body: ApplicationPatch = {};
      if (letterDirty) body.coverLetter = letter;
      if (application.pendingQuestions.length > 0) body.extraAnswers = answers;
      if (Object.keys(body).length > 0) await patch(body);
      return api.apply(application.id);
    }, "Submitting - this takes up to a minute");
  }

  async function markApplied() {
    await act("manual", async () => {
      await patch({ status: "applied", coverLetter: letter });
      onRemoved();
    }, "Marked as applied");
  }

  async function skip() {
    await act("skip", async () => {
      await patch({ status: "skipped" });
      onRemoved();
    });
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        <span
          className={cx("flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-semibold tabular-nums", scoreTone(application.score))}
          title="Match score"
        >
          {application.score}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50">{job.title}</h3>
            <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONES[status] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
              {STATUS_LABELS[status]}
            </span>
            {application.autoApproved && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                auto
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
            {job.company}
            {job.location && <> · {job.location}</>}
            {job.remote && !/remote/i.test(job.location) && <> · Remote</>}
            <span className="text-slate-400"> · {ATS_LABELS[job.ats]}{job.postedAt && <> · posted {timeAgo(job.postedAt)}</>}</span>
          </p>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{application.matchSummary}</p>
          {(application.strengths.length > 0 || application.gaps.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {application.strengths.map((item) => (
                <span key={`s-${item}`} className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                  + {item}
                </span>
              ))}
              {application.gaps.map((item) => (
                <span key={`g-${item}`} className="rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  − {item}
                </span>
              ))}
            </div>
          )}
          {application.lastError && (
            <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {application.lastError}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-stretch">
          {reviewable && application.canAutoApply && (
            <Button variant="primary" onClick={approve} loading={busy === "apply"} disabled={busy !== null}>
              {status === "failed" ? "Retry" : "Approve & apply"}
            </Button>
          )}
          {reviewable && !application.canAutoApply && (
            <Button variant="primary" onClick={markApplied} loading={busy === "manual"} disabled={busy !== null}>
              I applied
            </Button>
          )}
          {status === "applying" && (
            <Button variant="secondary" loading disabled>
              Submitting
            </Button>
          )}
          {tracked && (
            <select
              aria-label="Application outcome"
              value={status}
              onChange={(event) =>
                act("track", () => patch({ status: event.target.value as ApplicationStatus }))
              }
              className={controlClass(false, "w-auto")}
            >
              {TRACKING_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          )}
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Posting <ExternalIcon className="size-3.5" />
          </a>
          {reviewable && (
            <Button variant="ghost" onClick={skip} loading={busy === "skip"} disabled={busy !== null}>
              Skip
            </Button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="w-full border-t border-slate-100 px-4 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
      >
        {expanded ? "Hide details" : application.pendingQuestions.length > 0 ? "Answer questions & review letter" : "Cover letter & job description"}
      </button>

      {expanded && (
        <div className="flex flex-col gap-4 border-t border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
          {application.pendingQuestions.length > 0 && (
            <section className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                The application form asked something we could not answer for you
              </h4>
              {application.pendingQuestions.map((question) => (
                <label key={question.key} className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{question.label}</span>
                  {question.options.length > 0 ? (
                    <select
                      value={answers[question.key] ?? ""}
                      onChange={(event) => setAnswers({ ...answers, [question.key]: event.target.value })}
                      className={controlClass(false)}
                    >
                      <option value="">Choose...</option>
                      {question.options.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      rows={2}
                      value={answers[question.key] ?? ""}
                      onChange={(event) => setAnswers({ ...answers, [question.key]: event.target.value })}
                      className={controlClass(false)}
                    />
                  )}
                </label>
              ))}
              <p className="text-xs text-slate-500">
                Tip: answers you will need again belong in Profile → Screening answers.
              </p>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">Cover letter</h4>
              <div className="flex gap-2">
                {letterDirty && (
                  <Button
                    onClick={() => act("save", () => patch({ coverLetter: letter }), "Cover letter saved")}
                    loading={busy === "save"}
                    disabled={busy !== null}
                  >
                    Save
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => act("regen", () => api.regenerateCoverLetter(application.id), "New cover letter written")}
                  loading={busy === "regen"}
                  disabled={busy !== null}
                >
                  <SparkIcon className="size-4" /> Rewrite
                </Button>
              </div>
            </div>
            <textarea
              rows={12}
              value={letter}
              onChange={(event) => setLetter(event.target.value)}
              placeholder="No cover letter yet - click Rewrite to generate one."
              className={controlClass(false, "font-serif leading-relaxed")}
            />
          </section>

          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">Job description</summary>
            <p className="mt-2 whitespace-pre-line text-slate-600 dark:text-slate-300">{job.description}</p>
          </details>
        </div>
      )}
    </Card>
  );
}
