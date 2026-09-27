"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { ATS_LABELS, AUTO_APPLY_ATS, type JobSource } from "@/lib/types";
import { BuildingIcon, TrashIcon } from "./icons";
import { Toaster, useToasts } from "./Toaster";
import { Button, Card, EmptyState, Field, controlClass } from "./ui";

export function SourcesManager({ initial }: { initial: JobSource[] }) {
  const [sources, setSources] = useState(initial);
  const [url, setUrl] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const { toasts, notify, dismiss } = useToasts();

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const source = await api.addSourceByUrl(url, company);
      setSources((list) => [...list, source].sort((a, b) => a.company.localeCompare(b.company)));
      setUrl("");
      setCompany("");
      notify("success", `Following ${source.company} - ${source.jobCount} open roles`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not add that board");
    } finally {
      setAdding(false);
    }
  }

  async function remove(source: JobSource) {
    setRemoving(source.id);
    try {
      await api.deleteSource(source.id);
      setSources((list) => list.filter((item) => item.id !== source.id));
    } catch (caught) {
      notify("error", caught instanceof ApiError ? caught.message : "Could not remove that board");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          ApplyPilot watches the public job boards of the companies you pick. Paste a careers link hosted on
          Greenhouse, Lever or Ashby - for example <code className="font-mono">https://jobs.lever.co/acme</code>,{" "}
          <code className="font-mono">https://boards.greenhouse.io/acme</code> or{" "}
          <code className="font-mono">https://jobs.ashbyhq.com/acme</code>.
        </p>
      </div>

      <Card className="p-5">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end" noValidate>
          <Field label="Job board link" htmlFor="url" error={error ?? undefined}>
            <input id="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://jobs.lever.co/acme"
              className={controlClass(Boolean(error))} />
          </Field>
          <Field label="Company name (optional)" htmlFor="company">
            <input id="company" value={company} onChange={(event) => setCompany(event.target.value)} className={controlClass()} />
          </Field>
          <Button type="submit" variant="primary" loading={adding} disabled={!url.trim()} className={error ? "sm:mb-5" : undefined}>
            Follow
          </Button>
        </form>
      </Card>

      <Card>
        {sources.length === 0 ? (
          <EmptyState icon={<BuildingIcon className="size-6" />} title="No companies yet"
            description="Follow a few companies you would like to work for; their open roles are checked every time a search runs." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {sources.map((source) => (
              <li key={source.id} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{source.company}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {ATS_LABELS[source.ats]} · {source.boardToken} · {source.jobCount} open roles
                    {source.lastSyncedAt && <> · synced {timeAgo(source.lastSyncedAt)}</>}
                    {!AUTO_APPLY_ATS.includes(source.ats) && <> · manual apply</>}
                  </p>
                  {source.lastError && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{source.lastError}</p>}
                </div>
                <Button variant="ghost" onClick={() => remove(source)} loading={removing === source.id} aria-label={`Stop following ${source.company}`}>
                  <TrashIcon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}
