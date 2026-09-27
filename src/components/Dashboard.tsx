"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import type { Application, ApplicationView, DashboardStats, PipelineReport } from "@/lib/types";
import { ApplicationCard } from "./ApplicationCard";
import { InboxIcon, SparkIcon } from "./icons";
import { Toaster, useToasts } from "./Toaster";
import { Button, Card, EmptyState, cx } from "./ui";

interface SetupState {
  hasProfile: boolean;
  sourceCount: number;
  aiConfigured: boolean;
  liveSubmissions: boolean;
  autoApply: boolean;
}

const TABS: { view: ApplicationView; label: string }[] = [
  { view: "review", label: "To review" },
  { view: "active", label: "In progress" },
  { view: "done", label: "Applied" },
  { view: "all", label: "All" },
];

const EMPTY_COPY: Record<ApplicationView, { title: string; description: string }> = {
  review: {
    title: "Nothing to review",
    description: "Run a search to pull new postings from the companies you follow and score them against your profile.",
  },
  active: { title: "Nothing in flight", description: "Applications you approve show up here while they are submitted." },
  done: { title: "No applications yet", description: "Submitted applications and their outcomes are tracked here." },
  all: { title: "No postings evaluated yet", description: "Add some companies, then run a search." },
};

function summarize(report: PipelineReport): string {
  const parts = [
    `${report.newJobs} new posting${report.newJobs === 1 ? "" : "s"}`,
    `${report.suggested} to review`,
  ];
  if (report.autoApproved) parts.push(`${report.autoApproved} auto-approved`);
  if (report.submitted) parts.push(`${report.submitted} submitted`);
  if (report.needsInput) parts.push(`${report.needsInput} need your input`);
  if (report.sourceErrors.length) parts.push(`${report.sourceErrors.length} board(s) failed to sync`);
  return parts.join(", ");
}

export function Dashboard({ setup }: { setup: SetupState }) {
  const [view, setView] = useState<ApplicationView>("review");
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [running, setRunning] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { toasts, notify, dismiss } = useToasts();

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api.applications(view, controller.signal), api.stats(controller.signal)])
      .then(([list, counts]) => {
        setApplications(list);
        setStats(counts);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        notify("error", error instanceof ApiError ? error.message : "Could not load applications");
      });
    return () => controller.abort();
  }, [view, reloadKey, notify]);

  // While a submission is running in the background, poll for its outcome.
  const submitting = applications?.some((application) => application.status === "applying") ?? false;
  useEffect(() => {
    if (!submitting) return;
    const timer = setInterval(reload, 4000);
    return () => clearInterval(timer);
  }, [submitting, reload]);

  async function runSearch() {
    setRunning(true);
    try {
      const report = await api.runPipeline();
      notify("success", summarize(report));
      reload();
    } catch (error) {
      notify("error", error instanceof ApiError ? error.message : "The search failed");
    } finally {
      setRunning(false);
    }
  }

  function replace(updated: Application) {
    setApplications((list) => list?.map((item) => (item.id === updated.id ? updated : item)) ?? null);
    api.stats().then(setStats).catch(() => undefined);
  }

  const ready = setup.hasProfile && setup.sourceCount > 0 && setup.aiConfigured;
  const counts: Partial<Record<ApplicationView, number>> = stats
    ? { review: stats.toReview + stats.needsInput, active: stats.queued }
    : {};

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      {!ready && <SetupChecklist setup={setup} />}
      {ready && !setup.liveSubmissions && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <strong>Dry-run mode.</strong> Approved applications are filled in completely but not submitted. Set{" "}
          <code className="font-mono">APPLY_LIVE=true</code> on the server when you are ready to send them for real.
        </p>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {setup.autoApply
              ? "Auto-apply is on: strong matches on supported boards are submitted without review."
              : "Every application waits for your approval. Turn on auto-apply in your profile to skip the queue for strong matches."}
          </p>
        </div>
        <Button variant="primary" onClick={runSearch} loading={running} disabled={!ready}>
          {!running && <SparkIcon className="size-4" />}
          {running ? "Searching..." : "Find new jobs"}
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="To review" value={stats.toReview} />
          <Stat label="Need your input" value={stats.needsInput} tone={stats.needsInput > 0 ? "warn" : undefined} />
          <Stat label="Applied" value={stats.appliedTotal} hint={`${stats.appliedToday} today`} />
          <Stat label="Interviews & offers" value={stats.interviews} />
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            role="tab"
            aria-selected={view === tab.view}
            onClick={() => {
              setApplications(null);
              setView(tab.view);
            }}
            className={cx(
              "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              view === tab.view
                ? "border-indigo-600 text-indigo-700 dark:text-indigo-300"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {tab.label}
            {counts[tab.view] ? (
              <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {counts[tab.view]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {applications === null ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl bg-slate-200/60 dark:bg-slate-800/60" />
          ))}
        </div>
      ) : applications.length === 0 ? (
        <Card>
          <EmptyState icon={<InboxIcon className="size-6" />} {...EMPTY_COPY[view]} />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {applications.map((application) => (
            <ApplicationCard
              key={application.id}
              application={application}
              onChange={replace}
              onRemoved={reload}
              notify={notify}
            />
          ))}
        </div>
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "warn" }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cx("mt-1 text-2xl font-semibold tabular-nums", tone === "warn" && "text-amber-600 dark:text-amber-400")}>
        {value}
      </p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </Card>
  );
}

function SetupChecklist({ setup }: { setup: SetupState }) {
  const steps = [
    {
      done: setup.aiConfigured,
      label: "Add your Anthropic API key",
      detail: "Set ANTHROPIC_API_KEY in .env.local and restart the server.",
    },
    { done: setup.hasProfile, label: "Upload your resume", href: "/profile" },
    { done: setup.sourceCount > 0, label: "Pick companies to follow", href: "/sources" },
  ];
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Get set up</h2>
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step, index) => (
          <li key={step.label} className="flex items-start gap-3 text-sm">
            <span
              className={cx(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                step.done
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
              )}
            >
              {step.done ? "✓" : index + 1}
            </span>
            <div>
              {step.href && !step.done ? (
                <Link href={step.href} className="font-medium text-indigo-600 hover:underline">
                  {step.label}
                </Link>
              ) : (
                <span className={cx("font-medium", step.done && "text-slate-400 line-through")}>{step.label}</span>
              )}
              {step.detail && !step.done && <p className="text-slate-500 dark:text-slate-400">{step.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
